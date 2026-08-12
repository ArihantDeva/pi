# Architecture Decision: Behavior-Only Token Efficiency

## Approved contract

- **Outcome:** Test the previously listed model-behavior hypotheses and integrate only validated savings.
- **Scope:** Pi agent/coding-agent behavior: stop/loop discipline, repeated-tool avoidance, reasoning-level adaptation, conditional verification, model-specific prompt profiles, concise behavior, and prompt-policy optimization.
- **Evaluation:** Three domains only: code navigation/review, bug fixing, and small feature implementation. Use bounded baseline/variant comparisons and token, turn, tool-call, success, retry, and latency metrics.
- **Integration threshold:** Integrate a behavior only if it reduces median tokens per successful task by at least 15% with no more than a 2-point success-rate regression.
- **Exclusions:** No output-compression changes, context compaction, caching, sub-agent changes, orchestration changes, model/provider switching, or new dependencies.
- **API compatibility:** No new public API or CLI flag. Validated behavior will be integrated through existing system-prompt and thinking-level surfaces. Anything requiring a new public API pauses for approval.
- **Data/security:** Synthetic/local benchmark tasks only; no credentials or benchmark data committed.
- **Side effects:** No merge, push, deployment, hosted remote, or production changes. Bounded provider inference calls may run only through already-configured local authentication.
- **Validation:** `npm run check && npm test`, plus the bounded benchmark and fresh read-only review.

## Approval evidence

User approved this exact contract in the conversation after the autonomous-delivery architecture gate.

## Repository boundary

The source worktree had unrelated uncommitted changes in `packages/coding-agent/src/main.ts`, `packages/tui/src/tui.ts`, and `packages/tui/test/tui-render.test.ts`. This worktree starts from the current `HEAD` and does not include or modify those uncommitted changes.

## Amendments

None.
