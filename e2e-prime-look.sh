#!/bin/bash
# e2e-prime-look.sh — Frontier harness visual-parity + backend battery.
# Exits 0 only when all done-criteria pass. Offline UI checks are deterministic;
# the live chain-provider check is reported but non-fatal (gateway availability
# is external). Run from anywhere; paths are absolute.
set -u
REPO=/Users/arihantdeva/Repos/pi-harness
FAIL=0
NOTE=""

say()  { printf '%s\n' "$*"; }
pass() { say "  ✓ $*"; }
fail() { say "  ✗ $*"; FAIL=1; }
note() { say "  ~ $*"; NOTE="$NOTE $*"; }

say "== e2e-prime-look: builds =="
for pkg in agent tui coding-agent; do
  if (cd "$REPO/packages/$pkg" && npm run build >/tmp/e2e-build-$pkg.log 2>&1); then
    pass "build $pkg"
  else
    fail "build $pkg (see /tmp/e2e-build-$pkg.log)"
    tail -3 /tmp/e2e-build-$pkg.log
  fi
done

say "== e2e-prime-look: no debug instrumentation =="
DBG=0
grep -q "\[DBG" "$HOME/.pi/agent/extensions/chain-provider.ts" 2>/dev/null && DBG=1
grep -rq "\[DBG\|\[PUSH\|\[READ\|\[FLOW\|\[SSE" "$REPO/packages/coding-agent/dist" "$REPO/packages/tui/dist" "$REPO/packages/agent/dist" 2>/dev/null && DBG=1
if [ "$DBG" = "0" ]; then pass "no debug markers"; else fail "debug markers present"; fi

say "== e2e-prime-look: theme imports + palette =="
node --input-type=module -e "
import { loadThemeFromPath } from '$REPO/packages/coding-agent/dist/modes/interactive/theme/theme.js';
const t = loadThemeFromPath('$REPO/packages/coding-agent/dist/modes/interactive/theme/dark.json', 'truecolor');
const c = t.resolve ? t.resolve() : null;
const sample = t.bg('toolPanelBg', 'x');
if (!sample.includes('48;2;0;0;0') && !sample.includes('000000')) throw new Error('toolPanelBg not pure black: ' + JSON.stringify(sample.slice(0,30)));
const accent = t.fg('accent', 'x');
if (!/124;111;175/.test(accent) && !/7c6faf/.test(accent)) throw new Error('accent not prime purple: ' + accent.slice(0,40));
console.log('theme-ok');
" >/tmp/e2e-theme.log 2>&1
if [ $? = 0 ]; then pass "theme imports, panel bg + purple accent"; else fail "theme (see /tmp/e2e-theme.log)"; cat /tmp/e2e-theme.log; fi

say "== e2e-prime-look: light theme loads + new tokens =="
node --input-type=module -e "
import { loadThemeFromPath } from '$REPO/packages/coding-agent/dist/modes/interactive/theme/theme.js';
const t = loadThemeFromPath('$REPO/packages/coding-agent/dist/modes/interactive/theme/light.json', 'ansi');
const line = t.bg('toolPanelBg', 'x');
if (!/48;5;231/.test(line) && !/48;2;255;255;255/.test(line)) throw new Error('light toolPanelBg not white: ' + JSON.stringify(line.slice(0,20)));
t.bg('toolPendingBg', 'x'); t.bg('toolErrorBg', 'x'); t.fg('toolDiffText', 'x');
console.log('light-ok');
" >/tmp/e2e-light.log 2>&1
if [ $? = 0 ]; then pass "light theme loads, all new tokens render"; else fail "light theme (see /tmp/e2e-light.log)"; cat /tmp/e2e-light.log; fi

say "== e2e-prime-look: TUI render tests (offline) =="
cat > /tmp/e2e-ui.mjs <<'EOF'
import { setThemeInstance, loadThemeFromPath } from "/Users/arihantdeva/Repos/pi-harness/packages/coding-agent/dist/modes/interactive/theme/theme.js";
import { AssistantMessageComponent } from "/Users/arihantdeva/Repos/pi-harness/packages/coding-agent/dist/modes/interactive/components/assistant-message.js";
import { ToolExecutionComponent } from "/Users/arihantdeva/Repos/pi-harness/packages/coding-agent/dist/modes/interactive/components/tool-execution.js";
setThemeInstance(loadThemeFromPath("/Users/arihantdeva/Repos/pi-harness/packages/coding-agent/dist/modes/interactive/theme/dark.json", "truecolor"));
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\][^\x07]*\x07/g, "").replace(/\x1b\[\?2026[hl]/g, "").replace(/\s+$/gm, "").trim();
const out = [];
const ui = { requestRender() {} };

// 1. text streams live (distinct snapshots during one generation)
{
  const c = new AssistantMessageComponent();
  const snaps = new Set();
  let text = "";
  for (let i = 0; i < 8; i++) { text += `w${i} `; c.updateContent({ role: "assistant", content: [{ type: "text", text }], stopReason: null }); snaps.add(strip(c.render(80).join("\n"))); }
  out.push(["text streams live (>=6/8 distinct)", snaps.size >= 6]);
}

// 2. thinking collapsed recap row streams live + hint
{
  const c = new AssistantMessageComponent(undefined, true, undefined, "Thinking...");
  const snaps = new Set();
  let th = "";
  for (let i = 0; i < 5; i++) { th += `**Step ${i + 1}**:\nnote ${i + 1}\n`; c.updateContent({ role: "assistant", content: [{ type: "thinking", thinking: th }], stopReason: null }); const r = strip(c.render(100).join("\n")); snaps.add(r); }
  const any = [...snaps][0] ?? "";
  out.push(["thinking recap streams (>=4/5)", snaps.size >= 4]);
  out.push(["thinking recap row present", any.includes("Thinking") && any.includes("expand")]);
}

// 3. expanded thinking visible
{
  const c = new AssistantMessageComponent();
  c.updateContent({ role: "assistant", content: [{ type: "thinking", thinking: "**A**: the reasoning text" }, { type: "text", text: "Answer text." }], stopReason: "stop" });
  const r = strip(c.render(100).join("\n"));
  out.push(["expanded thinking text", r.includes("the reasoning text")]);
}

// 4. bash tool panel: collapsed header-only, expanded full
{
  let tec = new ToolExecutionComponent("bash", "c1", { command: "ls /tmp" }, {}, undefined, ui, "/tmp");
  tec.markExecutionStarted();
  tec.updateResult({ content: [{ type: "text", text: "f1\nf2" }], isError: false, details: {} });
  const collapsed = strip(tec.render(80).join("\n"));
  out.push(["bash collapsed header-only", collapsed.includes("bash ls /tmp") && !collapsed.includes("f1")]);
  tec.setExpanded(true);
  tec.updateResult({ content: [{ type: "text", text: "f1\nf2" }], isError: false, details: {} });
  const expanded = strip(tec.render(80).join("\n"));
  out.push(["bash expanded full ($, output, Took)", expanded.includes("$ ls /tmp") && expanded.includes("f1") && expanded.includes("Took")]);
}

// 5. tool panel pulse glyph + panel bg
{
  const tec = new ToolExecutionComponent("bash", "c2", { command: "sleep 1" }, {}, undefined, ui, "/tmp");
  tec.markExecutionStarted();
  const pending = strip(tec.render(80).join("\n"));
  out.push(["pending pulse glyph ◇", pending.includes("◇") || pending.includes("◈") || pending.includes("◆")]);
  tec.updateResult({ content: [{ type: "text", text: "" }], isError: false, details: {} });
  const done = strip(tec.render(80).join("\n"));
  out.push(["done ✓ glyph", done.includes("✓")]);
  const bgSample = tec.render(80).join("\n");
  out.push(["panel bg applied", bgSample.includes("48;2;0;0;0") || bgSample.includes("48;2;0;0;0")]);
}

for (const [name, ok] of out) console.log((ok ? "PASS" : "FAIL") + " " + name);
process.exit(out.every(([, ok]) => ok) ? 0 : 1);
EOF
if node /tmp/e2e-ui.mjs >/tmp/e2e-ui.log 2>&1; then
  pass "TUI render tests"
  sed 's/^/    /' /tmp/e2e-ui.log
else
  fail "TUI render tests"
  cat /tmp/e2e-ui.log
fi

say "== e2e-prime-look: backend battery =="
# Extension compiles
if npx --yes esbuild "$HOME/.pi/agent/extensions/chain-provider.ts" --bundle --platform=node --format=esm --outfile=/dev/null >/tmp/e2e-ext.log 2>&1; then
  pass "chain-provider extension compiles"
else
  fail "chain-provider extension broken"
  tail -5 /tmp/e2e-ext.log
fi
# Slash commands + model registry (offline): --list-models must show chain models
if node "$REPO/packages/coding-agent/dist/cli.js" --list-models "deepseek" 2>/dev/null | grep -qi "deepseek"; then
  pass "/models registry lists chain deepseek models"
else
  fail "--list-models chain check"
fi
if node "$REPO/packages/coding-agent/dist/cli.js" --list-models "glm" 2>/dev/null | grep -qi "glm"; then
  pass "/models registry lists glm models"
else
  note "glm not listed (may be unconfigured) — non-fatal"
fi

say "== e2e-prime-look: ipython tool (persistent kernel) =="
if node --input-type=module -e "
import { createIPythonTool } from '$REPO/packages/coding-agent/dist/core/tools/ipython.js';
const tool = createIPythonTool('/tmp');
const r1 = await tool.execute('t1', { cell: 'x = 41\nprint(x + 1)' });
const r2 = await tool.execute('t2', { cell: 'print(x * 2)' });
if (!r1.content[0].text.includes('42')) throw new Error('call1 wrong: ' + r1.content[0].text);
if (!r2.content[0].text.includes('82')) throw new Error('state did not survive: ' + r2.content[0].text);
let caught = false;
try { await tool.execute('t3', { cell: 'print(1/0)' }); } catch { caught = true; }
if (!caught) throw new Error('error cell did not reject');
const r4 = await tool.execute('t4', { cell: 'print(\"alive\", x)' });
if (!r4.content[0].text.includes('41')) throw new Error('kernel did not recover');
console.log('ipython-ok');
process.exit(0);
" >/tmp/e2e-ipy.log 2>&1; then
  pass "ipython persistent kernel (state, errors, recovery)"
else
  fail "ipython tool (see /tmp/e2e-ipy.log)"
  tail -5 /tmp/e2e-ipy.log
fi

say "== e2e-prime-look: pty boot (offline) =="
python3 - <<'EOF'
import os, pty, time, select, subprocess
master, slave = pty.openpty()
env = {**os.environ, "TERM": "xterm-256color"}
proc = subprocess.Popen(["pi-dev", "--no-approve"], stdin=slave, stdout=slave, stderr=slave, close_fds=True, cwd="/tmp", env=env)
os.close(slave)
out = b""
start = time.time()
while time.time() - start < 20:
    r, _, _ = select.select([master], [], [], 0.3)
    if r:
        try:
            data = os.read(master, 65536)
        except OSError:
            break
        if not data:
            break
        out += data
    if b"ponytail" in out:
        break
try: proc.kill()
except: pass
os.close(master)
text = out.decode("utf-8", "replace")
checks = {
  "boots with banner": "ponytail" in text or "escape" in text,
  "no crash": "Uncaught" not in text and "SyntaxError" not in text and "Unknown theme" not in text,
  "purple accent": "124;111;175" in text,
  "no pink border": "255;95;255" not in text,
}
for k, v in checks.items():
    print(("PASS" if v else "FAIL") + " " + k)
EOF
if python3 /tmp/e2e-pty.py >/tmp/e2e-pty.log 2>&1; then :; fi
python3 - <<'EOF' >/tmp/e2e-pty.log 2>&1
import os, pty, time, select, subprocess
master, slave = pty.openpty()
env = {**os.environ, "TERM": "xterm-256color"}
proc = subprocess.Popen(["pi-dev", "--no-approve"], stdin=slave, stdout=slave, stderr=slave, close_fds=True, cwd="/tmp", env=env)
os.close(slave)
out = b""
start = time.time()
while time.time() - start < 20:
    r, _, _ = select.select([master], [], [], 0.3)
    if r:
        try:
            data = os.read(master, 65536)
        except OSError:
            break
        if not data:
            break
        out += data
    if b"ponytail" in out:
        break
try: proc.kill()
except: pass
os.close(master)
text = out.decode("utf-8", "replace")
checks = {
  "boots with banner": "ponytail" in text or "escape" in text,
  "no crash": "Uncaught" not in text and "SyntaxError" not in text and "Unknown theme" not in text,
  "purple accent": "124;111;175" in text,
  "no pink border": "255;95;255" not in text,
}
ok = True
for k, v in checks.items():
    print(("PASS" if v else "FAIL") + " " + k)
    if not v: ok = False
print("RESULT", "OK" if ok else "FAIL")
EOF
if grep -q "RESULT OK" /tmp/e2e-pty.log; then pass "pty boot"; sed 's/^/    /' /tmp/e2e-pty.log; else fail "pty boot"; cat /tmp/e2e-pty.log; fi

say "== e2e-prime-look: live chain check (non-fatal) =="
timeout 45 node --input-type=module -e "
import { readFileSync } from 'node:fs';
const auth = JSON.parse(readFileSync(process.env.HOME + '/.pi/agent/auth.json', 'utf8'));
const key = auth['opencode-go']?.key;
if (!key) { console.log('SKIP no key'); process.exit(2); }
const resp = await fetch('https://opencode.ai/zen/go/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'deepseek-v4-flash', stream: true, messages: [{ role: 'user', content: 'Reply with exactly: E2E_LIVE_OK' }] }),
});
if (!resp.ok) { console.log('WARN gateway HTTP ' + resp.status + ' (external availability)'); process.exit(2); }
const reader = resp.body.getReader();
let n = 0;
while (true) { const { done } = await reader.read(); if (done) break; n++; if (n > 50) break; }
console.log('OK gateway streams, chunks=' + n);
process.exit(0);
" >/tmp/e2e-live.log 2>&1
rc=$?
if [ "$rc" = "0" ]; then
  pass "live chain stream (chunked)"
  sed 's/^/    /' /tmp/e2e-live.log
else
  note "live gateway check skipped/unavailable (rc=$rc) — external health"
  sed 's/^/    /' /tmp/e2e-live.log
fi

say ""
if [ "$FAIL" = "0" ]; then
  say "== e2e-prime-look: ALL PASS$([ -n "$NOTE" ] && echo ' (with notes)') =="
  exit 0
else
  say "== e2e-prime-look: FAILURES PRESENT =="
  exit 1
fi
