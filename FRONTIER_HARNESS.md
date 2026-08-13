# Frontier Harness — pi-mono fork configuration

Snapshot of the pi harness captured 2026-08-10 as the **frontier harness**:
a side-by-side fork of pi that diverges from published pi by design.

## Layout

| Piece | Location | Notes |
|---|---|---|
| Fork repo | `~/Repos/pi-harness` | pi-mono fork, base `@earendil-works/pi-coding-agent` 0.80.6 |
| Daily driver | `/opt/homebrew/bin/pi` | published npm install — untouched |
| Fork launcher | `~/.local/bin/pi-dev` | `node packages/coding-agent/dist/cli.js` |
| Shared config | `~/.pi/agent/` | both binaries use the same config/extensions/chains/skills |

## What the fork changes (vs published pi)

- **Working line** (`packages/coding-agent/src/modes/interactive/agent-activity.ts`,
  `interactive-mode.ts`): streaming loader shows live activity + elapsed + tokens,
  e.g. `Writing · 12s · ↓ 4.3k tokens`. Ported from Prime Agent
  (PrimeIntellect-ai/prime-agent, MIT), adapted to pi-mono 0.80.x event types.
  Includes char-estimate fallback for providers that only report usage at message end.

## Harness-side changes (apply to both binaries — in `~/.pi/agent`)

- `extensions/ask-multi.ts`: rewrote as ONE Claude-Code-style dialog card listing
  every question at once (`ctx.ui.custom` + `ui.select`/`ui.input` fallbacks).
  ↑/↓ navigate, Enter commits, Space toggles multi-select, Esc cancels.
- `pi-subagents/src/tui/fleet-status.ts`: colored status glyphs on all fleet rows
  (● running / ◦ queued / ✓ done / ✗ error / ◌ idle), cleaner `agent — description`
  rows. Note: `pi pkg update` overwrites this.

## Divergence policy

Published pi and pi-dev share `~/.pi/agent` config but will drift apart as the
fork carries forward the frontier TUI. Rebase the fork onto upstream pi-mono
before porting new upstream features. Rebuild after changes:
`cd ~/Repos/pi-harness/packages/coding-agent && npm run build`.

## Tag

`git tag -a frontier-harness-v1` on this snapshot.
