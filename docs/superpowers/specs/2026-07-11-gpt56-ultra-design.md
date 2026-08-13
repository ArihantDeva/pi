# GPT-5.6 Codex Ultra effort support

## Status

Approved design. Implementation target: Pi's OpenAI Codex provider and selector.

## Problem

Codex exposes `Ultra` as a selectable GPT-5.6 effort level. Pi currently stops at `max`, so its selector cannot represent the Codex mode or send the corresponding native request value.

`Ultra` is not a fourth GPT-5.6 model. It is a model-specific effort level whose Codex catalog description is `Maximum reasoning with automatic task delegation`. `Max` remains the maximum single-model reasoning level.

## Verified capability matrix

The local Codex model cache (`~/.codex/models_cache.json`, client version 0.144.0) reports:

| Codex model | Supported levels |
| --- | --- |
| `gpt-5.6-sol` | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` |
| `gpt-5.6-terra` | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` |
| `gpt-5.6-luna` | `low`, `medium`, `high`, `xhigh`, `max` |

The cache marks Ultra as API-supported. X and Reddit research independently describe Ultra as max-level reasoning plus automatic/proactive delegation, and distinguish it from Max's single-agent behavior.

## Design

1. Extend Pi's shared thinking-level vocabulary with `ultra`, ordered after `max`.
2. Treat `ultra` as opt-in model metadata, like `xhigh` and `max`. Models without an explicit `ultra` map entry must not expose it.
3. Add `ultra: "ultra"` only to the generated `openai-codex` GPT-5.6 Sol and Terra model entries. Do not add it to Luna, direct OpenAI, Azure, OpenRouter, or unrelated models without verified Codex support.
4. When the Codex provider receives `ultra`, send `reasoning.effort: "ultra"` unchanged. Do not silently downgrade it to `max` or emulate it with a prompt; the Codex backend is the source of automatic delegation behavior.
5. Preserve the existing global settings: the three `openai-codex/gpt-5.6-*` models remain selectable and `defaultThinkingLevel: "max"` remains the default. Users select Ultra with the thinking-level cycle or `--model openai-codex/gpt-5.6-sol:ultra` / `openai-codex/gpt-5.6-terra:ultra` shorthand.
6. Reuse the existing `thinkingMax` theme color for Ultra instead of adding a new required theme token.

## Files and responsibilities

- `packages/ai/src/types.ts`: shared thinking-level and map types.
- `packages/ai/src/models.ts`: supported-level ordering and clamping.
- `packages/ai/src/api/openai-codex-responses.ts`: Codex effort option type and request payload.
- `packages/ai/src/api/openai-responses.ts`, `openai-completions.ts`, and `azure-openai-responses.ts`: keep provider option types compatible with the shared vocabulary; unsupported models still clamp through metadata.
- `packages/ai/scripts/generate-models.ts`: generate Ultra metadata only for Codex Sol/Terra.
- `packages/ai/src/providers/openai-codex.models.ts`: regenerated catalog output; never hand-edit.
- `packages/ai/test/max-thinking.test.ts`: red/green coverage for the capability matrix and Codex payload.
- `packages/coding-agent/src/cli/args.ts`: recognize `ultra` in CLI/model-pattern parsing.
- `packages/coding-agent/src/core/model-registry.ts`: accept `ultra` in custom `thinkingLevelMap` validation.
- `packages/coding-agent/src/modes/interactive/theme/theme.ts`: render Ultra with the existing max color.
- `packages/agent/src/types.ts`: agent-level thinking type.
- `packages/coding-agent/test/core/model-resolver.test.ts`: resolver shorthand coverage.
- `packages/ai/README.md`, `packages/coding-agent/docs/models.md`, `packages/coding-agent/docs/settings.md`, and relevant changelogs: document the new model-specific level and Codex matrix.
- `~/.pi/agent/settings.json`: verify only; preserve the existing GPT-5.6 family entries and max default.

## Non-goals

- No fake `ultra` model IDs.
- No Ultra support for Luna or other providers without verified metadata.
- No changes to Codex's own `~/.codex/config.toml`.
- No new dependency.
- No custom prompt-based delegation emulation.

## Acceptance criteria

- Pi accepts `--thinking ultra` and `--model openai-codex/gpt-5.6-sol:ultra`.
- `getSupportedThinkingLevels` exposes Ultra for Codex Sol/Terra and excludes it for Codex Luna.
- A Codex Ultra request payload contains `reasoning: { effort: "ultra", summary: "auto" }`.
- Switching from Codex Ultra to Luna clamps to Luna's highest supported level rather than retaining an invalid Ultra level.
- Existing max/xhigh behavior remains unchanged.
- Relevant unit tests, typecheck, and build pass.
- The installed Pi package loads the updated catalog and exposes Ultra in the interactive selector for Codex GPT-5.6 Sol and Terra.
