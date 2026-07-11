# Internal Specification: Behavior-Only Token Efficiency

## Goal

Evaluate the model-behavior hypotheses from the approved contract on a small, representative coding-task corpus, then make the smallest default behavior change that meets the locked savings and quality thresholds. If no candidate meets the threshold, preserve runtime behavior and ship only regression tests/benchmark support if useful.

## Existing surfaces to reuse

- `packages/coding-agent/src/core/system-prompt.ts` builds the default coding-agent system prompt and already accepts prompt guidelines.
- `packages/agent/src/types.ts` and `packages/agent/src/agent-loop.ts` already expose turn lifecycle, stop-after-turn, tool-result termination, and per-turn thinking-level updates.
- Existing model metadata and `thinkingLevel` support must be reused. Do not invent a provider abstraction.
- Existing session statistics expose token, cost, message, and tool-call counts.

## Experiment arms

The benchmark must include a baseline and bounded variants representing every approved hypothesis without multiplying domains unnecessarily:

1. Baseline existing behavior.
2. Stop/loop discipline: no unchanged repeated reads/searches/tool calls; stop after verified completion; no extra planning turn.
3. Concise execution behavior, measured separately because output compression is already out of scope for production integration.
4. Conditional verification: verify when risk or uncertainty warrants it, then stop after success; do not add blanket self-critique.
5. Adaptive reasoning: compare supported existing thinking levels, escalating only after ambiguity, tool failure, or verification failure where the existing lifecycle can observe it.
6. Model-specific behavior profile, only where existing model metadata makes a deterministic distinction possible.
7. A small no-dependency candidate-policy search/optimizer over the above instruction fragments, treated as an experiment rather than a new framework.
8. A combined candidate using only variants that independently pass acceptance checks.

The implementation may reject a variant as unsupported or unsafe, but the benchmark/report must record that result and why. Do not fabricate live-model evidence.

## Evaluation corpus

Use three domains with three small tasks each:

- **Navigation/review:** locate behavior, explain a flow, or identify a defect without changing files.
- **Bug fixing:** reproduce/fix a contained defect with a focused test or check.
- **Feature implementation:** add a small local behavior with tests.

Tasks must be synthetic or use disposable fixtures. They must be repeatable and must not upload private repository content. Keep each run bounded and avoid adding a large benchmark framework.

## Metrics and acceptance

For each task/arm, record when available:

- total input, output, reasoning, and total tokens;
- assistant turns and tool calls;
- successful completion according to an objective task oracle;
- retries/rework and verification result;
- elapsed time and errors.

Use median tokens per successful task as the primary metric. A candidate is integrable only when it reduces that metric by at least 15% against baseline and does not reduce success rate by more than 2 percentage points. A candidate that saves tokens only by causing retries is a failure. If live provider credentials are unavailable, report live evaluation as unavailable and do not claim the candidate functions in production.

## Integration rules

- Integrate only passing behavior, using existing system-prompt and thinking-level surfaces.
- Do not add a public option, CLI flag, dependency, provider, cache, compaction strategy, sub-agent behavior, orchestration policy, or output-compression mechanism.
- Preserve explicit user-selected thinking levels unless the measured default behavior change is directly covered by the acceptance evidence.
- Do not add generic automatic stopping based solely on the absence of tool calls; existing tool-result termination and lifecycle hooks are the safety boundary.
- Do not ask the model to reveal private chain-of-thought.

## Failure behavior

Behavior policy failures must fail open to the existing behavior. Unsupported thinking levels must continue through existing model mapping. Benchmark/provider errors are recorded as failed/unavailable measurements, never converted into savings claims.

## Validation

Locked command: `npm run check && npm test`

Additional required checks are the focused package tests and the bounded benchmark command created by the implementation, with all commands recorded in the final validation artifacts.
