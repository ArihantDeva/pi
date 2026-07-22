# Tool reliability gates

This document is the canonical description of the local and CI gates for coding-agent tool changes.

## Commands

| Gate | Command | Failure condition |
| --- | --- | --- |
| Fast developer | `mise run coding-agent-fast` | Focused coding-agent test fails |
| Affected | `mise run coding-agent-affected` | Safe affected target fails; unknown mapping falls back broader |
| Release readiness | `mise run coding-agent-release` | Any check, offline test, or checked-in-catalog build command exits non-zero |
| No-cache | `mise run coding-agent-no-cache` | Release gates fail with an isolated temporary npm cache |
| Bootstrap parallel | `mise run coding-agent-bootstrap-parallel` | Any independent bootstrap check fails |
| Final verification | `mise run coding-agent-verify` | Release-readiness dependency fails |

## Rules

1. Production tests are written before the implementation they prove.
2. Tests observe public contracts and inject external capabilities.
3. A changed-file mapper may narrow execution only for known-safe mappings; uncertainty broadens it.
4. Parallel work must preserve every child exit status.
5. Caches may improve speed but must not change pass/fail results; no-cache uses a temporary npm cache. Tests run through `./test.sh` so local/provider-backed LLM tests are disabled. The existing repository check may still format files, so inspect the diff afterward.
6. Release builds compile checked-in model catalogs; live catalog refreshes remain an explicit separate operation. Independent bootstrap checks may run concurrently only when they share no mutable outputs and every exit status is retained.
7. Reddit/X reports are research evidence, not production failure-rate telemetry.
8. The production 0.01% failure target remains unmeasured until representative telemetry exists.

## Local/CI parity

GitHub CI must invoke the same `mise` release task as local validation after installing the repository's declared tools and dependencies. Any environment-specific difference must be recorded in the workflow and cannot weaken a gate.
