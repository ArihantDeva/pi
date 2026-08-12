#!/usr/bin/env python3
"""Smoke tests for session-stats.py (assert-based, no framework).

Run: python3 scripts/test-session-stats.py
Builds synthetic session JSONLs, asserts stats math, replay detection,
epoch-ms timestamp handling, and artifact capping.
"""
import json, os, sys, tempfile, importlib.util

_spec = importlib.util.spec_from_file_location(
    "session_stats", os.path.join(os.path.dirname(os.path.abspath(__file__)), "session-stats.py"))
session_stats = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(session_stats)

def w(path, records):
    with open(path, "w") as fh:
        for r in records:
            fh.write(json.dumps(r) + "\n")

def rec(t, **kw):
    d = {"type": t, "timestamp": kw.pop("ts", None)}
    d.update(kw)
    return d

def turn(calls, usage=None, ts="2026-08-01T00:00:00.000Z"):
    content = []
    for i, (name, args) in enumerate(calls):
        content.append({"type": "toolCall", "id": f"c{i}", "name": name, "arguments": args})
    return rec("message", ts=ts, message={"role": "assistant", "content": content,
                                          "usage": usage})

def result(call_id, name, ts_ms, is_error=False):
    return rec("message", ts=ts_ms, message={"role": "toolResult", "toolCallId": call_id,
                                             "toolName": name, "isError": str(is_error),
                                             "content": [{"type": "text", "text": "ok"}]})

def build_normal(tmp):
    """3 assistant turns, 2 bash (1 error) + 1 read, 1 compaction. ISO record ts."""
    rows = [
        rec("session", ts="2026-08-01T00:00:00.000Z"),
        turn([("bash", {"command": "echo hi"})],
             {"input": 100, "output": 10, "cacheRead": 200, "cacheWrite": 0, "totalTokens": 310},
             "2026-08-01T00:00:00.100Z"),
        result("c0", "bash", "2026-08-01T00:00:00.800Z"),          # 700ms, epoch-ms string
        turn([("bash", {"command": "false"})],
             {"input": 110, "output": 5, "cacheRead": 200, "cacheWrite": 0, "totalTokens": 315},
             "2026-08-01T00:00:01.000Z"),
        result("c0", "bash", "2026-08-01T00:00:01.100Z", is_error=True),  # 100ms, error
        turn([("read", {"path": "/x"})],
             {"input": 120, "output": 3, "cacheRead": 200, "cacheWrite": 0, "totalTokens": 323},
             "2026-08-01T00:00:02.000Z"),
        result("c0", "read", "2026-08-01T00:00:02.050Z"),          # 50ms
        rec("compaction", ts="2026-08-01T00:00:03.000Z"),
        rec("message", ts="2026-08-01T00:00:04.000Z",
            message={"role": "user", "content": [{"type": "text", "text": "done"}]}),
    ]
    p = os.path.join(tmp, "normal.jsonl")
    w(p, rows)
    return p

def build_replay(tmp):
    rows = [rec("session", ts="2026-08-01T00:00:00.000Z")]
    for i in range(12):
        rows.append(turn([("bash", {"command": "x"})], {"input": 0, "output": 0, "cacheRead": 0,
                                                        "cacheWrite": 0, "totalTokens": 0},
                         f"2026-08-01T00:00:{i:02d}.000Z"))
        rows.append(result("c0", "bash", f"2026-08-01T00:00:{i:02d}.500Z"))
    p = os.path.join(tmp, "replay.jsonl")
    w(p, rows)
    return p

def main():
    tmp = tempfile.mkdtemp()
    normal = build_normal(tmp)
    replay = build_replay(tmp)

    # 1. replay detection
    assert session_stats.is_replay(replay) is True, "replay file not detected"
    assert session_stats.is_replay(normal) is False, "normal file flagged replay"

    # 2. session_row on normal: math
    row = session_stats.session_row(normal, 0)
    assert row is not None
    assert row["turns"] == 3, row
    assert row["tools"] == 3, row
    # wall = 00:00.100 -> 00:00:04.000 = 3900ms; active = 700+100+50 = 850ms + interleaved waits
    assert abs(row["wall_min"] - 3.9 / 60) < 0.01, row
    assert row["compactions"] == 1, row
    assert row["prompt_tok/turn"] == (300 + 310 + 320) / 3, row  # input+cacheRead only
    assert abs(row["cache%"] - 100 * 600 / 930) < 0.01, row  # 200*3 cacheRead / 930 prompt

    # 3. replay-aware aggregate: replay excluded
    rows = []
    for p in (normal, replay):
        r = session_stats.session_row(p, 0)
        if r: rows.append(r)
    assert len(rows) == 1, rows

    # 4. per-tool stats with epoch-ms ts handling + error count
    agg = {r["name"]: r for r in session_stats.collect_tools([normal])}
    assert agg["bash"]["calls"] == 2 and agg["bash"]["errors"] == 1, agg
    assert agg["read"]["calls"] == 1 and agg["read"]["errors"] == 0, agg
    assert abs(agg["bash"]["median_ms"] - 400) < 1, agg  # 700 and 100 -> median 400

    # 5. artifact capping: absurd duration ignored
    p = os.path.join(tmp, "artifact.jsonl")
    rows = [rec("session", ts="2026-08-01T00:00:00.000Z"),
            turn([("bash", {"command": "long"})], {"input": 1, "output": 1, "cacheRead": 0,
                                                   "cacheWrite": 0, "totalTokens": 2},
                 "2026-08-01T00:00:00.100Z"),
            result("c0", "bash", "2026-08-02T12:00:00.000Z")]  # +36h (replay artifact)
    w(p, rows)
    t, tools, errs, comp, t0, t1 = session_stats.parse(p)
    assert tools.get("bash") in (None, []), tools  # duration capped away

    print("ALL SMOKE TESTS PASSED")
    return 0

if __name__ == "__main__":
    sys.exit(main())
