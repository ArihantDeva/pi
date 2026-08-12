#!/usr/bin/env python3
"""Per-session wall-clock + token stats from pi session JSONLs.

Usage:
  session-stats.py [--since DAYS] [--top K] [DIR]     per-session table
  session-stats.py --tools [--since DAYS] [DIR]        per-tool aggregate
  session-stats.py --session <file.jsonl>              one-session detail

Default DIR: ~/.pi/agent/sessions
"""
import json, os, statistics, sys, glob
from datetime import datetime, timezone, timedelta

DEFAULT_DIR = os.path.expanduser("~/.pi/agent/sessions")
# Replay/restored session files contain timestamp artifacts (e.g. tool results
# days after their calls). Durations above this are dropped as artifacts.
# ponytail: 24h cap, matches no real tool call in this harness.
ARTIFACT_MS = 24 * 3600 * 1000


def is_replay(path):
    """True when >50% of >=10 assistant messages carry zero usage (replay marker)."""
    tot = zero = 0
    with open(path) as fh:
        for line in fh:
            try: d = json.loads(line)
            except Exception: continue
            if d.get("type") != "message": continue
            m = d.get("message", {})
            if m.get("role") != "assistant": continue
            tot += 1
            u = m.get("usage") or {}
            if not (u.get("totalTokens") or u.get("input")):
                zero += 1
    return tot >= 10 and zero / tot > 0.5

def parse_args(argv):
    since, top, d, tools, sess = 30, 15, DEFAULT_DIR, False, None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--since": since = int(argv[i+1]); i += 2
        elif a == "--top": top = int(argv[i+1]); i += 2
        elif a == "--tools": tools = True; i += 1
        elif a == "--session": sess = argv[i+1]; i += 2
        else: d = a; i += 1
    return since, top, d, tools, sess

def ms(ts):
    if ts is None: return None
    if isinstance(ts, (int, float)): return ts
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp() * 1000
    except Exception:
        return None

def parse(path):
    """Yield per-turn tuples and collect tool durations."""
    turns = []   # (start_ms, dur_ms, usage, n_tools, tool_wait_ms)
    tools = {}   # name -> [durations ms]
    tool_errs = {}  # name -> count
    compactions = 0
    cur = None   # (assistant_ts, usage, n_tools, last_tool_result_ts)
    call_ts = {} # toolCallId -> assistant ts
    t0 = t1 = None
    with open(path) as fh:
        for line in fh:
            try: d = json.loads(line)
            except Exception: continue
            t = d.get("type")
            ts = ms(d.get("timestamp"))
            if t == "compaction":
                compactions += 1
                continue
            if t != "message": continue
            ts = ms(d.get("timestamp"))
            if ts is not None:
                t1 = ts
            m = d.get("message", {})
            role = m.get("role")
            if role == "assistant":
                if t0 is None: t0 = ts
                t1 = ts
                u = m.get("usage") or {}
                calls = [c for c in m.get("content", [])
                         if isinstance(c, dict) and c.get("type") == "toolCall"]
                for c in calls:
                    call_ts[c.get("id")] = ts
                if cur is not None:
                    turns.append(cur + (ts - cur[0],))
                cur = (ts, u, len(calls), None)
            elif role == "toolResult":
                tid = m.get("toolCallId")
                name = m.get("toolName") or "?"
                if tid in call_ts:
                    dur = (ts or 0) - call_ts.pop(tid)
                    if 0 <= dur < ARTIFACT_MS:
                        tools.setdefault(name, []).append(dur)
                if str(m.get("isError")).lower() == "true":
                    tool_errs[name] = tool_errs.get(name, 0) + 1
                if cur is not None:
                    cur = (cur[0], cur[1], cur[2], max(cur[3] or 0, ts or 0))
            elif role == "user":
                if cur is not None:
                    turns.append(cur + (ts - cur[0],))
                    cur = None
    if cur is not None:
        turns.append(cur + ((t1 or t0 or 0) - cur[0],))
    # Sibling of the tool-duration cap: restored-file artifact turns (e.g. tool
    # result days after the call) would otherwise inflate turn stats.
    turns = [t for t in turns if 0 <= t[4] < ARTIFACT_MS]
    return turns, tools, tool_errs, compactions, t0, t1

def session_row(path, since_ms):
    if is_replay(path):
        return None
    turns, tools, errs, comp, t0, t1 = parse(path)
    turns = list(turns)
    if not turns or t0 is None or t0 < since_ms or len(turns) < 2:
        return None
    wall = (t1 or t0) - t0
    durs = [t[4] for t in turns]
    active = sum(durs)
    tools_n = sum(t[2] for t in turns)
    tool_wait = sum(max(0, min(t[3] - t[0], t[4])) for t in turns if t[3])
    out_tok = sum((t[1] or {}).get("output", 0) for t in turns)
    pr_in = sum((t[1] or {}).get("input", 0) for t in turns)
    pr_cache = sum((t[1] or {}).get("cacheRead", 0) for t in turns)
    tot = pr_in + pr_cache
    ds = sorted(durs)
    return {
        "day": datetime.fromtimestamp(t0 / 1000, timezone.utc).strftime("%m-%d"),
        "turns": len(turns),
        "wall_min": wall / 60000,
        "active%": 100.0 * active / wall if wall else 0.0,
        "med_turn_s": statistics.median(durs) / 1000,
        "p90_turn_s": ds[int(len(ds) * 0.9)] / 1000,
        "tools": tools_n,
        "tools/turn": tools_n / len(turns),
        "tool_wait%": 100.0 * tool_wait / active if active else 0.0,
        "prompt_tok/turn": tot / len(turns) if turns else 0,
        "cache%": 100.0 * pr_cache / tot if tot else 0.0,
        "out_tok/turn": out_tok / len(turns) if turns else 0,
        "compactions": comp,
    }

def collect_tools(paths, since_ms=0):
    """Aggregate per-tool durations + error counts across files."""
    agg, errs = {}, {}
    for path in paths:
        if is_replay(path):
            continue
        try: turns, tools, terr, comp, t0, t1 = parse(path)
        except Exception: continue
        if t0 is None or t0 < since_ms:
            continue
        for name, durs in tools.items():
            agg.setdefault(name, []).extend(durs)
        for name, n in terr.items():
            errs[name] = errs.get(name, 0) + n
    rows = sorted(((n, d) for n, d in agg.items()), key=lambda x: -sum(x[1]))
    out = []
    for name, durs in rows:
        ds = sorted(durs)
        out.append({"name": name, "calls": len(durs), "median_ms": statistics.median(durs),
                    "p90_ms": ds[int(len(ds) * 0.9)], "total_min": sum(durs) / 60000,
                    "errors": errs.get(name, 0)})
    return out


def detail(path):
    """Per-session detail: per-turn rows + per-tool rows + totals."""
    if is_replay(path):
        print("REPLAY FILE (zero-usage): stats unreliable, skipped")
        return
    turns, tools, errs, comp, t0, t1 = parse(path)
    turns = [t for t in turns if t[4] >= 0]
    if not turns:
        print("no usable turns")
        return
    print(f"session: {os.path.basename(path)}  turns={len(turns)}  wall_min={((t1 or t0) - t0) / 60000:.1f}"
          f"  compactions={comp}")
    print("turn\tdur_s\ttools\twait_ms\tprompt\tout")
    for i, t in enumerate(turns):
        u = t[1] or {}
        print(f"{i}\t{t[4] / 1000:.1f}\t{t[2]}\t{t[3] - t[0] if t[3] else 0:.0f}"
              f"\t{(u.get('input', 0) or 0) + (u.get('cacheRead', 0) or 0)}\t{u.get('output', 0) or 0}")
    print("\ntool\tcalls\tmedian_ms\tp90_ms\tmin\terrors")
    for r in collect_tools([path]):
        print(f"{r['name']}\t{r['calls']}\t{r['median_ms']:.0f}\t{r['p90_ms']:.0f}\t{r['total_min']:.2f}\t{r['errors']}")


def main():
    since, top, d, tools_only, sess = parse_args(sys.argv[1:])
    cutoff = (datetime.now(timezone.utc) - timedelta(days=since)).timestamp() * 1000
    if sess:
        detail(sess)
        return
    paths = glob.glob(os.path.join(d, "*", "*.jsonl"))
    if tools_only:
        for r in collect_tools(paths, cutoff):
            print(f"{r['name']}\t{r['calls']}\t{r['median_ms']:.0f}\t{r['p90_ms']:.0f}\t{r['total_min']:.1f}\t{r['errors']}")
        return
    rows = []
    for path in paths:
        try: r = session_row(path, cutoff)
        except Exception: continue
        if r: rows.append(r)
    rows.sort(key=lambda r: r["turns"], reverse=True)
    cols = ["day", "turns", "wall_min", "active%", "med_turn_s", "p90_turn_s",
            "tools/turn", "tool_wait%", "prompt_tok/turn", "cache%", "out_tok/turn", "compactions"]
    print("\t".join(cols))
    for r in rows[:top]:
        print("\t".join(f"{r[c]:.1f}" if isinstance(r[c], float) else str(r[c]) for c in cols))
    print(f"\n({len(rows)} sessions in {since}d window; top {top} shown)")

if __name__ == "__main__":
    main()
