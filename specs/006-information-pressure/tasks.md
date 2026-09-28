---
description: "Task list for Information Pressure (with reply model selection)"
---

# Tasks: Information Pressure (with reply model selection)

**Input**: Design documents from `specs/006-information-pressure/`: [spec.md](./spec.md),
[plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/](./contracts/) and [quickstart.md](./quickstart.md).

**Tests**: included, as in earlier features. The quickstart scenarios map to the test tasks
below.

**Format**: `[ID] [P?] [Story] Description`. `[P]` means the task can run in parallel, because it
touches different files and has no unfinished dependencies.

## Phase 1: Setup

- [X] T001 Create the migration `src/server/db/migrations/0006_information_pressure.ts`
  (forward-only, with a `down()` that throws), per data-model.md:
  1. `CREATE TABLE setting_changes`:
     - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
     - `key text NOT NULL CHECK (key IN ('information_pressure', 'reply_model'))`
     - `value jsonb NOT NULL`
     - `provenance provenance NOT NULL DEFAULT 'user_authored' CHECK (provenance = 'user_authored')`
     - `created_at timestamptz NOT NULL DEFAULT now()`
     - `CHECK (key <> 'information_pressure' OR (jsonb_typeof(value) = 'number' AND (value)::int BETWEEN 1 AND 10))`
     - `CHECK (key <> 'reply_model' OR jsonb_typeof(value) = 'string')`
  2. `CREATE INDEX setting_changes_latest ON setting_changes (key, created_at DESC, id DESC)`.
  3. Create the function `setting_changes_append_only()`, which raises
     `'setting_changes is append-only'`, and a trigger `setting_changes_append_only` BEFORE UPDATE
     OR DELETE FOR EACH ROW that runs it.
  4. `ALTER TABLE messages ADD COLUMN pressure_level smallint CHECK (pressure_level BETWEEN 1 AND 10), ADD COLUMN reply_model text`.

  In `src/server/db/schema.ts`, add `SettingChangesTable` (`value: ColumnType<unknown, string, never>`,
  `provenance: ColumnType<Provenance, never, never>`) and register it in `Database`. Add
  `pressure_level: number | null` and `reply_model: string | null` to `MessagesTable`, as
  `ColumnType<…, … | undefined, never>` so they can't be updated through Kysely.
- [X] T002 Run `npm run db:migrate` and `npm run db:migrate -- --test`. Add `setting_changes` to the
  TRUNCATE lists in `tests/integration/setup.ts` and `tests/e2e/helpers.ts` (`resetDb`).

---

## Phase 2: Foundational (blocks all stories)

- [X] T003 [P] Create `src/shared/pressure.ts`:
  - `PRESSURE_BANDS = ["Brief", "Concise", "Balanced", "Detailed", "Exhaustive"] as const`
  - `MIN_PRESSURE = 1`, `MAX_PRESSURE = 10`, `DEFAULT_PRESSURE = 8`
  - `bandOf(level)`, which returns `PRESSURE_BANDS[Math.ceil(level / 2) - 1]`
- [X] T004 [P] Create `src/shared/models.ts` with `REPLY_MODELS` (the exact 6 entries and order in
  data-model.md), `type ReplyModelChoice`, `isReplyModelChoice(x)`, and `modelLabel(id: string | null)`.
  `modelLabel` returns "Default model" for null, the label for a known ID, and the raw ID
  otherwise.
- [X] T005 Update `src/shared/schemas.ts`:
  - Add `pressureLevel: z.number().int().nullable()` and `replyModel: z.string().nullable()` to
    `Message`.
  - Add `SettingsResponse = z.object({ informationPressure: z.number().int().min(1).max(10), replyModel: z.string(), models: z.array(z.object({ id: z.string(), label: z.string() })) })`.
  - Add `SaveSettingsBody = z.object({ informationPressure: z.number().int().min(1).max(10).optional(), replyModel: z.string().optional() }).refine((b) => b.informationPressure !== undefined || b.replyModel !== undefined)`.

  Update `toMessage` in `src/server/mappers.ts` to map `pressure_level` → `pressureLevel` and
  `reply_model` → `replyModel`. Fix any test fixtures that build `Message` objects by hand, so
  `npm run typecheck` passes.
- [X] T006 Create `src/server/settings/settings.ts`:
  - **`getSettings(db | trx)`**: the newest `setting_changes` row per key, ordered by
    `created_at desc, id desc`. With no row it gives `DEFAULT_PRESSURE` and `"default"`. A stored
    `reply_model` that fails `isReplyModelChoice` reads as `"default"`. It returns
    `{ informationPressure, replyModel }`.
  - **`saveSettings(patch)`**:
    1. Validate: the level must be an integer from 1 to 10, and the model must pass
       `isReplyModelChoice`. Otherwise throw `InvalidRequestError` (422).
    2. In a transaction, read the current values and insert one row
       `{ key, value: JSON.stringify(v) }` per field that differs.
    3. Return `getSettings()`.
  - **`settingsResponse()`**: `{ ...getSettings(), models: REPLY_MODELS }`.
- [X] T007 Create the route `src/app/api/settings/route.ts`:
  - `GET` returns `settingsResponse()`.
  - `PUT` parses the body with `readJson(req, SaveSettingsBody)` and returns `saveSettings(...)`.

  Register `/^\/api\/settings$/` in `tests/integration/helpers.ts`. Add
  `getSettings: () => request("GET", "/api/settings", SettingsResponse)` and
  `saveSettings: (patch) => request("PUT", "/api/settings", SettingsResponse, patch)` to
  `src/lib/api.ts`.
- [X] T008 Add `pressureLevel: number | null` and `model: string | null` to `ReplyInput` in
  `src/server/ai/provider.ts`, with the doc comments from `contracts/ai-provider.md`. Add
  `resolveReplyModel(choice: ReplyModelChoice): string | null` to `src/server/ai/index.ts`, per the
  contract: `claude` → `CLAUDE_MODEL ?? "claude-opus-5"`, `claude-code` → `CLAUDE_CODE_MODEL ?? null`,
  `fake` → null for `"default"`, and the choice itself otherwise.
- [X] T009 In `src/server/messages/send.ts`, make `insertPendingReply(trx, nodeId, seq)` call
  `getSettings(trx)` and insert
  `pressure_level: s.informationPressure, reply_model: resolveReplyModel(s.replyModel)`. This is
  the only place AI messages are created: send, retry, regenerate, and the quick branch through
  send.
  - Change `generate(nodeId, messageId)` to pass `{ replyMessageId: messageId }` to
    `buildReplyInput`.
  - In `src/server/messages/replyInput.ts`, load the reply row by `replyMessageId` and return
    `pressureLevel: row.pressure_level, model: row.reply_model`. Without `replyMessageId`, return
    `null, null`.
  - Update every other `buildReplyInput` caller (`grep -rn buildReplyInput src`) and every test
    that builds a `ReplyInput` literal to include the two fields.

**Checkpoint**: settings can be read and saved through the API, and each new AI reply row carries
the level and model active at its creation.

---

## Phase 3: User Story 1 — Set how much detail replies contain (P1) 🎯 MVP

**Goal**: a Settings page with the 10-stop banded slider. The chosen level shapes new replies with
no reload.

**Independent test**: quickstart scenarios 1, 2 and 8.

### Tests for User Story 1

- [X] T010 [P] [US1] Unit tests in `tests/unit/f6-prompts.test.ts`:
  - `lengthGuidance(n)` for n = 1…10 returns 10 distinct strings, each ending with "Match this
    length unless the person explicitly asks for a different length in their message."
  - `buildReplyRequest({ …, pressureLevel: 3 })` has the guidance as its last system block, after
    the branch context when there is one. With `pressureLevel: null` there's no extra block.
  - `buildHeadlessReply` includes the guidance.
  - `buildSummaryRequest`, `buildDefineRequest` and `buildSuggestRequest` produce identical output
    whatever the level (SC-005). They take no level, so assert that their output doesn't contain
    any guidance string.
- [X] T011 [P] [US1] Integration tests in `tests/integration/f6-settings.test.ts`:
  - A fresh GET returns `{ informationPressure: 8, replyModel: "default", models: REPLY_MODELS }`
    (SC-004).
  - PUT `{ informationPressure: 2 }` → 200 and one row. An unchanged PUT adds no row. Three changes
    give three rows, all `user_authored`.
  - A PUT with `{}`, `11`, `0`, `2.5` or `{ replyModel: "gpt" }` → 422.
  - A raw `UPDATE setting_changes …` and `DELETE FROM setting_changes …` both reject.
  - Set 2, send with `?wait=1`, and `getFakeCalls().lastReply.pressureLevel === 2`. Set 10 and send
    again: the value is 10, with no restart (SC-001).

### Implementation for User Story 1

- [X] T012 [US1] In `src/server/ai/claudePrompts.ts`:
  - Add `LENGTH_GUIDANCE`, the 10 sentences from research R1, and
    `lengthGuidance(level): string`, which appends the closing line.
  - In `buildReplyRequest`, when `input.pressureLevel !== null`, push
    `{ type: "text", text: lengthGuidance(input.pressureLevel) }` last.
  - Don't touch the summary, define or suggest builders.
- [X] T013 [P] [US1] Create `src/components/settings/SettingsForm.tsx` (client component), per
  `contracts/ui.md`:
  - It loads `api.getSettings()`.
  - **Level section**: `<input type="range" min=1 max=10 step=1 aria-label="Information pressure"
    data-testid="pressure-slider" aria-valuetext="{n} · {band}">`. Under it, a band row of five
    labels, each spanning two stops, with the current one marked `aria-current="true"`. A readout
    shows `Level {n} · {band}` (`data-testid="pressure-readout"`).
  - Saving happens on `change`, not `input`: disable the control, call
    `api.saveSettings({ informationPressure })`, then show "Saved" (`role="status"`, 2 s). On error,
    go back to the last stored value and show "Couldn't save. Your previous setting is still in
    effect" (`role="alert"`).
  - Add the scope note: "Applies to new chat replies in every conversation. Summaries, definitions
    and suggestions aren't affected."
- [X] T014 [US1] Create `src/app/settings/page.tsx`, which renders `<SettingsForm />` under the
  heading "Settings". Create `src/components/common/SettingsLink.tsx`: a `Link href="/settings"`
  with ⚙ and `aria-label="Settings"`. Add it to the top bar in `src/app/layout.tsx`, between
  `NewConversationButton` and `FeedbackButton`. Add the `.settings-page`, `.pressure-bands` and
  `.pressure-band[aria-current="true"]` styles to `src/app/globals.css`, with the band row as a
  five-column grid under the slider.

**Checkpoint**: US1 works. Changing the slider changes the next reply's guidance.

---

## Phase 4: User Story 2 — The level applies everywhere, automatically (P1)

**Goal**: every way of getting a reply uses the live global level. It's delivered by T009; this
phase proves it.

**Independent test**: quickstart scenario 3.

- [X] T015 [US2] Integration tests in `tests/integration/f6-settings.test.ts`. At level 3, each of
  these records `pressure_level = 3` on its AI message, and the fake's matching `replyInputs` entry
  has `pressureLevel: 3`:
  - a root reply
  - a highlight-branch reply (POST branches, then send)
  - a `????` quick-branch reply
  - a retry of a failed reply (fake `fail`, then `ok`, then retry)
  - a regenerate

  Also: set 3 and send in node A, set 6 and send again in node A (opened before the change). The
  second reply records 6 (US2 AS3).

---

## Phase 5: User Story 3 — See what level produced a past reply (P2)

**Goal**: each reply keeps and shows its own level.

**Independent test**: quickstart scenario 4.

### Tests for User Story 3

- [X] T016 [P] [US3] Integration tests in `tests/integration/f6-settings.test.ts`:
  - A reply recorded at 4 still reads 4 through `GET /api/nodes/{id}` after changing to 9.
  - With fake `chunkDelayMs: 300`, start a reply at 5, PUT 9 mid-stream, and after the end the
    reply records 5 and `replyInputs.at(-1).pressureLevel === 5`.
  - Stopped and failed replies record a level too.
  - User messages have `pressureLevel: null`.
  - An AI message inserted without the columns, simulating one from before this feature, maps to
    `pressureLevel: null, replyModel: null`.

### Implementation for User Story 3

- [X] T017 [US3] In `src/components/chat/Message.tsx`, for `isAi && message.pressureLevel !== null`,
  render
  `<span className="reply-meta" data-testid="reply-meta" title="Settings when this reply was written">{bandOf(l)} · {l} · {modelLabel(message.replyModel)}</span>`
  in the `.role` row after the AI tag. Make the `.role` row render whenever `isAi` is true (it
  already does). Add `.reply-meta { font-size: 0.75em; color: var(--muted); }` to
  `src/app/globals.css`.

---

## Phase 6: User Story 4 — Choose which model writes replies (P2)

**Goal**: a model selection in Settings. Replies are requested from the chosen model and labelled
with it.

**Independent test**: quickstart scenario 5.

### Tests for User Story 4

- [X] T018 [P] [US4] Unit tests in `tests/unit/f6-providers.test.ts`:
  - **ClaudeCodeProvider**: refactor `runHeadless`'s argument building into an exported pure
    `headlessArgs(system, options)` in `src/server/ai/claudeCode.ts`. With
    `model: "claude-sonnet-5"` the args include `["--model", "claude-sonnet-5"]`. With
    `model: null` and no `CLAUDE_CODE_MODEL` there's no `--model`.
  - **ClaudeProvider**: export a pure `replyParams(input)` from `src/server/ai/claude.ts` that
    returns the request body. For `claude-sonnet-5` and `claude-haiku-4-5` it has no `betas` or
    `fallbacks`. For `claude-opus-5`, `claude-opus-5-5` and `claude-fable-5-1` it has
    `betas: [FALLBACK_BETA], fallbacks: "default"`. For `model: null` the model is
    `CLAUDE_MODEL ?? "claude-opus-5"`.
  - `resolveReplyModel` gives the contract table's results for each `AI_PROVIDER` (set
    `process.env` inside the test).
- [X] T019 [P] [US4] Integration tests in `tests/integration/f6-settings.test.ts`:
  - PUT `{ replyModel: "claude-sonnet-5" }`, then send. `lastReply.model === "claude-sonnet-5"`
    and the reply's `replyModel === "claude-sonnet-5"`.
  - PUT `"default"`, then send. `model: null` (fake).
  - A stored stale value (insert a raw row `'"claude-gone"'`) reads as `"default"`.
  - A summary run after choosing Sonnet has a `lastSummary` input with no model field (FR-018).

### Implementation for User Story 4

- [X] T020 [US4] In `src/server/ai/claude.ts`:
  - Add `FALLBACK_MODELS = new Set(["claude-opus-5", "claude-opus-5-5", "claude-fable-5-1"])` and
    `replyParams(input)`, which builds the streaming body with `model = input.model ?? MODEL` and
    includes `betas` and `fallbacks` only when the model is in `FALLBACK_MODELS`.
  - Make `reply()` use `replyParams`.
  - In `toProviderError`, map `Anthropic.NotFoundError`, and `Anthropic.BadRequestError` whose
    message contains "model", to `AIUnavailableError(\`The chosen model (${model}) isn't available\`)`
    (thread the model through as a second parameter).
  - Summaries, definitions and suggestions keep using `MODEL` and the fallbacks.
- [X] T021 [US4] In `src/server/ai/claudeCode.ts`:
  - Export `headlessArgs(system, { effort, model })`.
  - `runHeadless` takes `model?: string | null` and adds `--model` from
    `model ?? process.env.CLAUDE_CODE_MODEL` when set.
  - `reply()` passes `input.model`. Summaries, definitions and suggestions pass nothing, as today.
- [X] T022 [P] [US4] In `src/server/ai/fake.ts`, no code change is needed beyond `lastReply`
  already storing the full input. Check that `replyInputs` exposes `model` and `pressureLevel` for
  the T019 assertions.
- [X] T023 [US4] In `src/components/settings/SettingsForm.tsx`, add the "Reply model" section:
  `<select aria-label="Reply model" data-testid="model-select">` with `models` from the GET in
  order. The "Default" option gets the hint text "the model Farabi is configured with". Save on
  `change` with the same saving, "Saved" and alert behavior as the slider.

---

## Phase 7: Polish & Cross-Cutting

- [X] T024 [P] Playwright tests in `tests/e2e/f6-settings.spec.ts`, with `beforeEach` running
  `resetDb` and `setAiMode("ok")`:
  - **Defaults**: open ⚙ Settings. The readout is "Level 8 · Detailed", the Detailed band is
    `aria-current`, and the model is "Default".
  - **Level**: press `ArrowLeft` six times on the slider. The readout is "Level 2 · Brief" and
    "Saved" shows. Start a conversation and send. `reply-meta` reads "Brief · 2 · Default model".
  - **Model**: select "Claude Sonnet 5" and send in the same conversation. The new `reply-meta`
    reads "Brief · 2 · Claude Sonnet 5", and the earlier reply's label is unchanged.
  - **Failed save**: `page.route("**/api/settings", …)` returns 500 for PUT. After the change, the
    slider goes back to the stored level and the alert is visible.
  - **Reachable from anywhere**: the ⚙ link is present on the map, chat and definitions views
    (SC-006).
- [X] T025 [P] Extend `tests/integration/constitution.test.ts`:
  - `setting_changes` rows are all `user_authored`.
  - No file in `src/` matches
    `updateTable\("messages"\)[\s\S]{0,300}?(pressure_level|reply_model)`.
  - `setting_changes` is referenced only from `src/server/settings/`, `src/server/db/` and
    migrations (Article VI, 1.0.1: nothing else is tuned from it).
  - `src/server/summaries/`, `src/server/definitions/` and `src/server/suggestions/` never mention
    `pressure` or `reply_model` (FR-007, FR-018).
- [X] T026 [P] Add a "Settings" section to `README.md`: what the level does (replies only, bands,
  default 8), the model choices, that "Default" follows `CLAUDE_MODEL` or `CLAUDE_CODE_MODEL`, and
  that each reply is labelled with its settings.
- [X] T027 Manual SC-002 check with `AI_PROVIDER=claude-code`. Send the same 5 prompts at levels 1,
  5 and 10 through `ClaudeCodeProvider.reply` directly (a scratch script) and record the average
  word counts in `research.md` R1. Also send one reply with Claude Haiku 4.5 selected to confirm
  the CLI accepts the model. This uses the user's subscription, so keep it to these few calls.
- [X] T028 Full run: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`.

---

## Dependencies & Execution Order

- **Setup (T001–T002)**, then **Foundational (T003–T009)**, then **US1 (T010–T014)**, then
  **US2 (T015)**, **US3 (T016–T017)** and **US4 (T018–T023)**, then **Polish (T024–T028)**.
- **Foundational**:
  - T003 and T004 can run in parallel.
  - T005 comes after T004. T006 comes after T003, T004 and T005. T007 comes after T006.
  - T008 comes after T004. T009 comes after T006 and T008.
- **US1**: T012 comes before T010 passes. T013 comes before T014.
- **US2, US3 and US4** each depend only on Foundational and can follow US1 in any order. US4's
  T023 extends US1's `SettingsForm` (T013). US3's label shows the model through `modelLabel`
  (T004), so it doesn't need US4.

## Parallel Examples

```text
Foundational: T003 (pressure.ts) ‖ T004 (models.ts)
US1 tests:    T010 (unit) ‖ T011 (integration)
US1 impl:     T012 (claudePrompts.ts) ‖ T013 (SettingsForm.tsx)
US4:          T018 (unit) ‖ T019 (integration) ‖ T022 (fake check)
Polish:       T024 (e2e) ‖ T025 (constitution) ‖ T026 (README)
```

## Implementation Strategy

- **MVP**: Phases 1–3. The slider changes reply length, and each reply stores its level. Validate
  with quickstart scenarios 1, 2 and 8.
- **Next**: US2 (proof that it applies everywhere), then US3 (labels), then US4 (model selection).
  Each can be shipped on its own.
- **Finish**: Polish adds the guards, README and end-to-end tests, and the one manual length check
  with your real setup.
