# Contract: AI Provider changes

This extends the Feature 2 and Feature 5 contracts.

```ts
interface ReplyInput {
  // …inheritedContext, anchorText, messages, signal unchanged
  /** Information pressure level for this reply; null means no length guidance (old callers, tests). */
  pressureLevel: number | null;
  /** Model ID for this reply; null means the setup's configured default. */
  model: string | null;
}
```

- `SummaryInput`, `DefineInput` and `SuggestSpansInput` are unchanged. They never carry a level or
  a model (FR-007, FR-018).
- `buildReplyInput(nodeId, { excludeMessageId, replyMessageId })` reads `pressure_level` and
  `reply_model` from the pending reply's own row.

## Prompt (`claudePrompts.ts`)

- `lengthGuidance(level: number): string` returns the level's sentence from research R1, plus the
  closing line "Match this length unless the person explicitly asks for a different length in
  their message."
- `buildReplyRequest(input)` pushes `{ type: "text", text: lengthGuidance(level) }` as the last
  system block when `input.pressureLevel` isn't null.
- `buildHeadlessReply` inherits that block, because it joins the system blocks.
- The summary, define and suggest builders are untouched.

## Per setup

| Setup | Model use |
|-------|-----------|
| `claude` | `model: input.model ?? MODEL`. It sends `betas: [FALLBACK_BETA], fallbacks: "default"` only when the model is in `FALLBACK_MODELS` = {`claude-opus-5`, `claude-opus-5-5`, `claude-fable-5-1`}. A `NotFoundError`, or a `BadRequestError` whose message mentions the model, maps to `AIUnavailableError("The chosen model (<id>) isn't available")`. |
| `claude-code` | Adds `--model <input.model ?? CLAUDE_CODE_MODEL>` when either is set; otherwise passes no `--model`, as today. |
| `fake` | Records `input.pressureLevel` and `input.model` in `lastReply`. The output text is unchanged, so earlier tests keep passing. |

## Resolving the model (`src/server/ai/index.ts`)

```ts
/** The model ID a reply will use for a given choice, or null when the setup's default is unknown. */
export function resolveReplyModel(choice: ReplyModelChoice): string | null;
// claude:      choice === "default" ? (CLAUDE_MODEL ?? "claude-opus-5") : choice
// claude-code: choice === "default" ? (CLAUDE_CODE_MODEL ?? null) : choice
// fake:        choice === "default" ? null : choice
```
