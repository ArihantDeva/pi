# Validate and Integrate Behavior-Only Token Efficiency

## Overview
Evaluate the approved model-behavior hypotheses on a bounded three-domain coding-task corpus, then integrate only candidates meeting the locked token and quality thresholds. Keep infrastructure, orchestration, sub-agents, context compaction, caching, and output compression unchanged.

## Context
- Locked contract: `docs/autodev/behavior-token-efficiency/decision.md`
- Internal spec: `docs/autodev/behavior-token-efficiency/spec.md`
- Locked verification command: `npm run check && npm test`

### Task 1: Establish behavior-policy and benchmark contracts
- [ ] Add focused failing tests for the smallest internal behavior-policy surface and metric/acceptance calculations described in `docs/autodev/behavior-token-efficiency/spec.md`
- [ ] Run `npm run test --workspace @earendil-works/pi-agent-core -- agent-loop.test.ts` and observe the expected failure
- [ ] Implement the smallest contract-compliant policy/measurement types using existing prompt, loop, and thinking-level surfaces
- [ ] Run `npm run test --workspace @earendil-works/pi-agent-core -- agent-loop.test.ts` and repair until it passes

### Task 2: Test candidate behaviors across bounded task domains
- [ ] Add failing tests for three synthetic task domains, baseline/variant isolation, objective success oracles, and token/turn/tool/retry metric collection
- [ ] Run the focused benchmark test command and observe the expected failure
- [ ] Implement a bounded no-dependency benchmark runner using existing test/CLI/provider seams; include all hypotheses from the internal spec without expanding beyond three domains
- [ ] Run the exact bounded benchmark command and record candidate results, unavailable-provider states, and failure reasons
- [ ] Repair benchmark/test failures without relaxing the locked acceptance thresholds

### Task 3: Integrate only validated behavior
- [ ] Add regression tests proving the selected behavior changes affect only approved prompt/thinking surfaces and fail open to existing behavior
- [ ] Run `npm run test --workspace @earendil-works/pi-coding-agent -- system-prompt.test.ts` and observe the expected failure
- [ ] Integrate only candidates that meet the 15% median-token and 2-point success-rate thresholds; leave non-passing candidates out of runtime behavior
- [ ] Run `npm run test --workspace @earendil-works/pi-coding-agent -- system-prompt.test.ts` and repair until it passes

### Task 4: Full validation and cleanup
- [ ] Run `npm run check && npm test`
- [ ] Run the bounded benchmark command again from the final worktree and verify the locked acceptance evidence
- [ ] Remove only speculative or non-winning runtime code while preserving tests and evidence needed to explain rejected hypotheses
- [ ] Run `npm run check && npm test` again after cleanup

## Success criteria
- [ ] Every approved hypothesis is tested or explicitly recorded as unsupported/unavailable without fabricated evidence
- [ ] Only behavior meeting the locked acceptance threshold is integrated
- [ ] `npm run check && npm test` passes in this worktree
- [ ] No unapproved core decision or out-of-scope change was made
