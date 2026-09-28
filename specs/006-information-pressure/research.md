# Research: Information Pressure (and reply model selection)

## R1. How a level becomes reply length: a system-prompt block

- **Decision**: Add one more system block, `lengthGuidance(level)`, as the last system block of
  every reply request, after `REPLY_SYSTEM` and any branch context. Each level has a fixed
  sentence with an approximate target length. The bands are what the user sees; the ten sentences
  are internal.

  | Level | Band | Guidance (approximate) |
  |-------|------|------------------------|
  | 1 | Brief | One or two sentences. Only the direct answer. |
  | 2 | Brief | A short paragraph, about 60 words. |
  | 3 | Concise | About 100 words; the answer plus the single most useful detail. |
  | 4 | Concise | About 175 words. |
  | 5 | Balanced | About 275 words; explain the reasoning briefly. |
  | 6 | Balanced | About 400 words. |
  | 7 | Detailed | About 550 words; cover the main aspects with an example where it helps. |
  | 8 | Detailed | About 750 words. |
  | 9 | Exhaustive | About 1,100 words; cover the topic thoroughly, including nuances and edge cases. |
  | 10 | Exhaustive | As long as the topic warrants; be exhaustive. |

  Every block ends with the same instruction: "Match this length unless the person explicitly asks
  for a different length in their message." That keeps Article I (the person's direct request
  wins over the default).
- **Rationale**: Prompt guidance works the same with all three setups (API, CLI, fake) and all
  models. `max_tokens` stays at 64,000. Using it as a length control would cut replies off
  mid-sentence, which Feature 2 treats as an incomplete reply.
- **Caching**: the level block comes after the stable prefix, so the cached `REPLY_SYSTEM` stays
  valid. Changing the level re-caches the rest of that conversation once, which is acceptable for
  an occasional setting change. Mid-conversation system messages were rejected because Sonnet 5
  and Haiku 4.5 don't support them, and the level must work on every listed model.
- **Scope (FR-007)**: only `buildReplyRequest` and `buildHeadlessReply` add the block. The summary,
  define and suggest builders are unchanged, and a unit test checks that their output is identical
  at every level (SC-005).
- **SC-002 check**: a manual comparison (a task in Polish) sends 5 fixed prompts at levels 1, 5 and
  10 with the user's own setup and compares average word counts.
  - **Measured 2026-09-27 (T027)** through the Claude Code CLI setup (default model), with 5
    prompts per level:
    - level 1: 56 words on average (48–65)
    - level 5: 295 (286–310)
    - level 10: 1,389 (1,039–1,982)
  - Every band rose, and level 10 is about 25× level 1, so SC-002 passes. Level 1 runs a little
    long for "one or two sentences" but is clearly the brief end.
  - A test reply with `--model claude-haiku-4-5` succeeded in 4.6 s, which confirms the CLI accepts
    the full model name.

## R2. Model list and how each setup uses it

- **Decision**: a fixed list in `src/shared/models.ts`, per the Claude API reference (cached
  2026-06-24):

  | Choice | Model ID | Label |
  |--------|----------|-------|
  | `default` | as configured | Default |
  | `claude-opus-5` | `claude-opus-5` | Claude Opus 5 |
  | `claude-opus-5-5` | `claude-opus-5-5` | Claude Opus 5.5 |
  | `claude-fable-5-1` | `claude-fable-5-1` | Claude Fable 5.1 |
  | `claude-sonnet-5` | `claude-sonnet-5` | Claude Sonnet 5 |
  | `claude-haiku-4-5` | `claude-haiku-4-5` | Claude Haiku 4.5 |

- **Claude API setup** (`claude.ts`): `reply` uses `input.model ?? MODEL`, where `MODEL` is
  `CLAUDE_MODEL ?? "claude-opus-5"`. It adds the refusal-fallback beta and `fallbacks: "default"`
  only for models documented to support them: Opus 5, Opus 5.5 and Fable 5.1. Sonnet 5 and Haiku
  4.5 are sent without them.
  - Reply requests set no `effort` and no `thinking`. That's valid on every listed model, including
    Haiku 4.5, which rejects `effort`. It means Opus 5.5 runs at its default `medium` effort.
  - `max_tokens: 64000` stays, which is within every listed model's output limit.
- **Claude Code CLI setup** (`claudeCode.ts`): pass `--model <id>` when a model is chosen.
  `claude --help` (2.1.283) confirms that `--model` accepts full model names. "Default" keeps
  today's behavior: `CLAUDE_CODE_MODEL` if set, otherwise the CLI's own default.
- **Fake setup**: ignores the model, but records it in `lastReply` for tests.
- **Summaries, definitions and suggestions** keep using `MODEL` / `CLAUDE_CODE_MODEL` (FR-018).
- **Unavailable model** (US4 AS5): the existing error mapping turns API 4xx/5xx and CLI failures
  into `AIUnavailableError`, so the reply fails with Retry offered. A 404 or 400 caused by the
  model is added to `toProviderError` as `AIUnavailableError("The chosen model (…) isn't
  available")`. The Claude Code CLI's own message is passed through as it is today.
- **Risk**: fallback support on Opus 5.5 is taken from the reference and not yet checked live (no
  API key here). Implementation keeps the list in one constant, so it's a one-line change if a 400
  shows otherwise.

## R3. Where the settings live: an append-only `setting_changes` table

- **Decision**: one table, `setting_changes(id, key, value jsonb, provenance, created_at)`.
  - `key` is `'information_pressure'` or `'reply_model'`.
  - The value in effect for a key is its newest row; with no row, the default applies
    (8 / `"default"`).
  - A database trigger rejects UPDATE and DELETE, as Feature 3 did for feedback history
    (FR-013, FR-020, Article VI).
  - `provenance` is CHECKed to `user_authored` (Article I).
- **Rationale**:
  - "Global per install" (spec Assumptions) rules out localStorage.
  - One table covers both settings and any later ones without a migration each.
  - The newest row per key is cheap to read: an index on `(key, created_at DESC)`, and a
    single-user app.
- **Alternatives considered**: a mutable `settings` row, rejected because it loses the history
  FR-013 requires; one table per setting, which is more schema for the same thing.

## R4. Recording level and model on each reply

- **Decision**: two nullable columns on `messages`:
  - `pressure_level smallint CHECK (pressure_level BETWEEN 1 AND 10)`
  - `reply_model text`
- **How they're set**: `insertPendingReply` is the only place an AI message is created (send,
  retry, regenerate, and the quick branch via send). It reads the current settings and writes both
  columns in the same INSERT, so the values are fixed at generation start (FR-009, the streaming
  edge case).
  - `buildReplyInput` then reads them from that message row, never from the live settings.
- **`reply_model` holds the resolved model ID**:
  - The Claude API setup's `default` resolves to `CLAUDE_MODEL ?? "claude-opus-5"`.
  - The Claude Code CLI setup's `default` resolves to `CLAUDE_CODE_MODEL`, or to NULL when unset,
    because the CLI's own default isn't known ahead of time.
  - The fake setup resolves to NULL for `default`.
- **Telling old replies apart**: replies from before this feature have `pressure_level` NULL, and
  the UI shows neither level nor model for them (US3 AS4). A post-feature reply with a NULL model
  shows "Default model".
- **Immutability (FR-010)**: nothing updates these columns after insert. A constitution guard test
  checks that no `updateTable("messages")` sets them. Existing replies are not backfilled.
- **Resolving the model**: `resolveReplyModel(choice)` lives next to `getAIProvider` in
  `src/server/ai/index.ts`, because the result depends on `AI_PROVIDER`.

## R5. Settings page and how settings are read

- **Decision**:
  - A new route, `/settings` (`src/app/settings/page.tsx`), linked from a ⚙ button in the top bar
    (`SettingsLink`).
  - The page loads `GET /api/settings`, which returns `{ informationPressure, replyModel, models }`.
  - Moving the slider or the select sends `PUT /api/settings` with just the changed field. The
    page only shows the new value after the server confirms it; on failure it shows the stored
    value again, with "Couldn't save" (spec edge case). Existing routes already use PUT for
    replace-style writes such as edge labels and positions, so PUT fits here.
  - The server reads the settings from the database on every insert. There's no cache, so a
    change takes effect on the next reply without a reload (FR-005, FR-017).
- **Slider**: `<input type="range" min=1 max=10 step=1>` guarantees the ten snap points (FR-002).
  A row of five band labels sits under it, each spanning two stops, and the current band is
  highlighted. The current value reads "8 · Detailed" (`aria-valuetext`).
- **Label on each reply (FR-011, FR-019)**: `Message.tsx` shows a muted `.reply-meta` next to the
  AI tag, for example "Detailed · 8 · Claude Opus 5", with a title explaining that this was the
  setting when the reply was written. It's shown only when `pressureLevel` isn't null.

## R6. Constitution

- Article VI (1.0.1 clarification): the level and model are explicit user instructions. Neither is
  read by any code other than reply generation (a guard test greps for readers of
  `setting_changes`).
- Article I: settings changes are `user_authored`. Replies stay `ai_suggested`.
- Article II: no DELETE or PATCH routes; settings history is append-only in the database.
