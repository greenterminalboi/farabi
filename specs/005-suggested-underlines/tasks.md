---
description: "Task list for Suggested Branch Underlines"
---

# Tasks: Suggested Branch Underlines

**Input**: Design documents from `specs/005-suggested-underlines/`: [spec.md](./spec.md),
[plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/](./contracts/) and [quickstart.md](./quickstart.md).

**Tests**: included, as in earlier features. The quickstart scenarios map to the test tasks
below.

**Format**: `[ID] [P?] [Story] Description`. `[P]` means the task can run in parallel, because it
touches different files and has no unfinished dependencies.

## Phase 1: Setup

- [X] T001 Create migration `src/server/db/migrations/0005_span_suggestions.ts` (forward-only, with
  the same `down()` that throws as `0004_projects.ts`) creating `span_suggestions`:
  - `message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE`
  - `detector_version integer NOT NULL`
  - `spans jsonb NOT NULL`
  - `provenance text NOT NULL DEFAULT 'ai_suggested' CHECK (provenance = 'ai_suggested')`
  - `created_at timestamptz NOT NULL DEFAULT now()`
  - `PRIMARY KEY (message_id, detector_version)`

  Add `SpanSuggestionsTable` (with `spans: ColumnType<SuggestedSpanRow[], string, never>`, or an
  equivalent JSON typing) and `span_suggestions` to `Database` in `src/server/db/schema.ts`.
- [X] T002 Run `npm run db:migrate` and `npm run db:migrate -- --test`. Add `span_suggestions` to
  the TRUNCATE lists in `tests/integration/setup.ts` (line 41) and `tests/e2e/helpers.ts`
  (line 10).

---

## Phase 2: Foundational (blocks both stories)

- [X] T003 [P] Add to `src/shared/schemas.ts`, per `contracts/http-api.md`:
  - `SuggestedSpan = z.object({ start: z.number().int(), end: z.number().int(), text: z.string() })`
  - `SuggestionsResponse = z.object({ byMessage: z.record(z.string(), z.array(SuggestedSpan)), pending: z.array(z.string()) })`
  - the exported types for both
- [X] T004 [P] Add `SuggestSpansInput { text: string; signal?: AbortSignal }` and
  `suggestSpans(input): Promise<string[]>` to `AIProvider` in `src/server/ai/provider.ts`. Use the
  doc comment from `contracts/ai-provider.md`.
- [X] T005 Add the following to `src/server/ai/claudePrompts.ts`:
  - **`SUGGEST_SYSTEM`**: the prompt asks for up to 3 phrases of 2–20 words, each copied character
    for character from the reply. Each names an idea the reader could explore as its own
    conversation. Phrases must be plain prose with no markdown symbols and no line breaks. The
    model should reply `NONE` if nothing clearly stands out, and fewer phrases are better. The
    output is one `SPAN: <phrase>` line per phrase, or `NONE`.
  - **`buildSuggestRequest(input)`**: returns `{ system, prompt }`, with the reply wrapped in
    `<reply>…</reply>` using the existing `escape`.
  - **`parseSpans(text)`**: keeps the trimmed text after each `SPAN:` line. `NONE`, or no lines at
    all, gives `[]`. Output with neither `SPAN:` lines nor `NONE` throws `AIUnavailableError`.

  Also export `SPAN_DETECTOR_VERSION = 1`.
- [X] T006 Implement `suggestSpans` in each provider:
  - **`src/server/ai/claude.ts`**: `beta.messages.create`, `max_tokens: 1000`, the same
    `betas` and `fallbacks` as `summarize`, `output_config: { effort: "low" }`. Pass the result
    through `parseSpans(textOf(message))` and errors through `toProviderError`.
  - **`src/server/ai/claudeCode.ts`**: `parseSpans(await runHeadless(system, prompt, { effort: "low", signal }))`.
  - **`src/server/ai/fake.ts`**: record `lastSuggest` (add it to `FakeState`, `getFakeCalls` and
    `resetFakeCalls`, plus a `suggestCalls` counter). Call `await behave(input.signal)`. Split
    `text` into sentences on `(?<=[.!?])\s+` and keep those with 2–20 words that don't start with
    `Echo:`. Return the first 3. For `Echo: Pods. Containers are mentioned here.` the result must
    be `["Containers are mentioned here."]`.
- [X] T007 [P] Create `src/server/suggestions/locate.ts` with the pure function
  `locateSpans(content: string, phrases: string[]): SuggestedSpan[]` (research R2). For each
  trimmed phrase:
  1. Find `start = content.indexOf(phrase)` and skip it if the result is `-1`.
  2. Skip it if its word count is < 2 or > 20, or its length is > 200.
  3. Skip it if it contains `\n` or any of `` ` * [ ] < > | # ``.
  4. Sort by `start` and drop any phrase overlapping one already kept.
  5. Keep the first 3.

  Each result is `{ start, end: start + phrase.length, text: phrase }`, and it must satisfy
  `content.slice(start, end) === text`.
- [X] T008 [P] Unit tests in `tests/unit/f5-locate.test.ts` for `locateSpans`:
  - exact match, first occurrence
  - paraphrase dropped
  - 1-word and 21-word phrases dropped; more than 200 characters dropped
  - markdown characters and line breaks dropped
  - overlapping phrase dropped
  - 5 valid phrases cut to 3

  Also in `tests/unit/claudePrompts.test.ts`, test `parseSpans`: `SPAN:` lines, `NONE`, empty
  output → `[]`, and junk throws.
- [X] T009 Create `src/server/suggestions/queue.ts`, with the same `globalThis` queue shape as
  `src/server/summaries/queue.ts` (research R4, R5):
  - **`run(messageId)`**: load the message. Continue only if it's `role = 'ai'`,
    `status = 'complete'` and `replaced_at IS NULL`. Call
    `getAIProvider().suggestSpans({ text: content })` and pass the result through `locateSpans`.
    Then
    `insertInto("span_suggestions").values({ message_id, detector_version: SPAN_DETECTOR_VERSION, spans: JSON.stringify(spans) }).onConflict((oc) => oc.doNothing())`.
  - **Failures**: on `AIUnavailableError` (or any error, logging the ones that aren't
    `AIUnavailableError`), set `failedAt.set(messageId, Date.now())` and insert nothing.
  - **Exports**:
    - `enqueueSuggestions(messageIds)`: coalesces per message and skips ids whose `failedAt` is
      within the last 5 minutes. At most 2 run at once.
    - `waitForSuggestions(messageIds, timeoutMs)`: resolves when those ids are no longer queued or
      running, or when the timeout expires.
    - `isSuggesting(id)` and `inCooldown(id)`.
    - `drainSuggestions()` and `resetSuggestionQueue()` (clears `failedAt`), for tests.

  Register `drainSuggestions()` and `resetSuggestionQueue()` in `tests/integration/setup.ts`
  next to `drainDrafts`.
- [X] T010 Create `src/server/suggestions/forNode.ts` with
  `suggestionsForNode(nodeId): Promise<SuggestionsResponse>`:
  1. `assertId`, and throw `NotFoundError` if the node is missing.
  2. List the node's live, complete AI messages, newest first.
  3. Read their `span_suggestions` rows for `SPAN_DETECTOR_VERSION`.
  4. Enqueue the ones that have no row, aren't in cooldown and aren't running.
  5. `waitForSuggestions(missing, 5000)` and read the rows again.
  6. Return `byMessage` (analyzed ones only, `[]` allowed) and `pending` (still missing, excluding
     ones in cooldown).

  This function must not read from or write to any table except `messages`, `nodes` and
  `span_suggestions`.
- [X] T011 Create the route `src/app/api/nodes/[nodeId]/suggestions/route.ts`:
  `export const POST = withApi(...)`, which returns `Response.json(await suggestionsForNode(nodeId))`.
  Register the pattern `/^\/api\/nodes\/([^/]+)\/suggestions$/` in `tests/integration/helpers.ts`.
  Add `getSuggestions: (nodeId) => request("POST", \`/api/nodes/${nodeId}/suggestions\`, SuggestionsResponse, {})`
  to `src/lib/api.ts`.

**Checkpoint**: the server returns validated, cached suggestions per message.

---

## Phase 3: User Story 1 — Notice a branch-worthy span without hunting for it (P1) 🎯 MVP

**Goal**: completed AI replies show at most 3 grey dotted suggestions. Clicking one selects exactly
that text, and the existing Define/Branch toolbar appears.

**Independent test**: quickstart scenarios 1, 2, 3 and 6. Send "Pods", then click "Containers are
mentioned here." The toolbar appears. Branch creates a child whose anchor is that exact text. No
underline appears while streaming, on stopped or incomplete replies, or on user messages. No rows
are written outside `span_suggestions`.

### Tests for User Story 1

- [X] T012 [P] [US1] Integration tests in `tests/integration/f5-suggestions.test.ts`:
  - **Basic result**: after `POST /api/nodes/{id}/messages?wait=1` with "Pods", the endpoint
    returns
    `byMessage[aiId] = [{ text: "Containers are mentioned here.", start, end }]` with
    `content.slice(start, end) === text`, and `pending: []`.
  - **Excluded messages**: the user message id is never a key. Stopped and incomplete replies
    (fake `stall`) are never keys (FR-003, FR-007).
  - **Cache**: a second call makes no new fake `suggestSpans` call (FR-013, SC-006).
  - **Nothing else written (SC-004)**: row counts for every table except `span_suggestions` are
    unchanged by the call.
  - **Failure**: in fake `fail` mode, the message is absent from both `byMessage` and `pending`,
    and no row is inserted. A second call within the cooldown makes no new AI call.
  - **404**: an unknown node returns 404.
- [X] T013 [P] [US1] Extend `tests/unit/markerRanges.test.ts` for suggestion ranges in
  `splitByMarkers`: segments are cut at suggestion edges, `seg.suggestion` is set, and
  `segmentAttributes` gives the `suggest-mark` class and `data-suggest="s-e"`. Extend
  `tests/unit/selection.test.ts` so that `selectionToAnchor(rangeForOffsets(el, s, e), contentOf)`
  returns `{ start: s, end: e, text }` for:
  - plain text
  - a span crossing a `<strong>` element
  - a span crossing a marker segment boundary

### Implementation for User Story 1

- [X] T014 [US1] In `src/components/chat/markerRanges.ts`:
  - Add a fifth parameter, `suggestions: SuggestedSpan[] = []`, to `splitByMarkers`. Add its
    starts and ends to `cuts`, and add
    `suggestion: { start: number; end: number } | null` to `Segment` (the covering suggestion).
  - In `segmentAttributes`, push `"suggest-mark"` and return `suggest: \`${start}-${end}\``.
  - In `src/components/chat/rehypeSourceOffsets.ts`, accept `suggestions` in the options, pass
    them to `segmentSpans` and `splitByMarkers`, and set `properties["data-suggest"]`.
- [X] T015 [US1] In `src/components/chat/Message.tsx`:
  - Add the prop `suggestions: SuggestedSpan[]` (a stable empty-array default, like
    `NO_MARKERS`) and pass it to `MarkdownText` only in the `status === "complete" && isAi`
    branch.
  - Stopped and incomplete `MarkdownText`, `PlainText` and streaming get no suggestions (FR-003,
    FR-007).
  - Include `suggestions` in `MarkdownText`'s `rehypePlugins` memo dependencies.
- [X] T016 [P] [US1] Add `rangeForOffsets(messageEl: HTMLElement, start: number, end: number): Range | null`
  to `src/components/chat/selection.ts`. It's the inverse of `rawOffset`: find the
  `span[data-start]` elements where `data-start ≤ start < data-end` and
  `data-start < end ≤ data-end`, take their text nodes, and `setStart` and `setEnd` at
  `offset - data-start`. It returns null if either end can't be found.
- [X] T017 [US1] Add `.suggest-mark` to `src/app/globals.css` (research R6, `contracts/ui.md`):
  ```css
  background-image: radial-gradient(circle, var(--muted) 0.75px, transparent 1px);
  background-size: 4px 2px;
  background-repeat: repeat-x;
  background-position: 0 100%;
  padding-bottom: 2px;
  ```
  Also add `cursor: pointer` for `.suggest-mark:not(.term-mark)`. It must not set
  `text-decoration`, `border` or `background-color`. Check that `.marker.suggest-mark` still shows
  its amber fill and border.
- [X] T018 [US1] In `src/components/chat/ChatView.tsx`:
  1. Keep `const [suggestions, setSuggestions] = useState<Record<string, SuggestedSpan[]>>({})`,
     reset when `nodeId` changes.
  2. Add an effect that runs when `view` changes. If there's a complete AI message whose id isn't
     in `suggestions`, call `api.getSuggestions(nodeId)` and merge `byMessage`. While `pending` is
     non-empty and the component is mounted, call again, up to 6 rounds. Ignore errors.
  3. Pass `suggestions={suggestions[m.id] ?? NO_SUGGESTIONS}` to `Message`.
  4. Extend `onListClick` in this order:
     1. `[data-markers]` (existing).
     2. `.term-mark` → return.
     3. `[data-suggest]` while `sel.isCollapsed` → parse `start-end`, find the
        `closest("[data-message-id]")` element, and call
        `const r = rangeForOffsets(msgEl, start, end)`. If `r` is set,
        `sel.removeAllRanges(); sel.addRange(r)`.

     `BranchAction` shows the toolbar through `selectionchange`, and must not change.

**Checkpoint**: US1 works on its own. Clicking a suggestion gives the same toolbar and branch as a
manual drag.

---

## Phase 4: User Story 2 — Suggested spans stay out of the way of confirmed structure (P2)

**Goal**: suggestions, definition underlines and branch markers are all visible on shared text,
and each keeps its own click behavior. The user can turn suggestions off (FR-012).

**Independent test**: quickstart scenarios 4 and 5.

### Tests for User Story 2

- [X] T019 [P] [US2] Playwright tests in `tests/e2e/f5-suggestions.spec.ts`, covering quickstart
  scenarios 1–6:
  - **Scenario 1**: the suggestion shows, clicking it shows the toolbar with
    `getSelection().toString()` equal to the span text, and Branch opens a child whose anchor is
    that text.
  - **Scenario 2**: no `.suggest-mark` while streaming with `chunkDelayMs: 400`, or on
    stopped or stalled replies.
  - **Scenario 4**:
    - Capture "Containers" as a definition. The word has `.term-mark.suggest-mark`, and hovering
      shows the term card.
    - Clicking "Containers" leaves the selection collapsed. Clicking "mentioned" selects the whole
      span.
    - Branch from the suggestion, reload, and click. The child branch opens.
    - Screenshot the three styles side by side for SC-003.
  - **Scenario 5**: toggle off → 0 `.suggest-mark` and no `/suggestions` request (using
    `page.on("request")`). Reload → still off. Toggle on → the marks return.
  - **Scenario 6**: fake `fail` → no mark and no error message.

### Implementation for User Story 2

- [X] T020 [P] [US2] Create `src/state/settingsStore.ts`: a zustand store with the `persist`
  middleware (`zustand/middleware`), name `"farabi.settings"`, state
  `{ showSuggestions: boolean }` (default `true`) and `setShowSuggestions(v)` (research R8).
- [X] T021 [US2] Add a toggle button to `src/components/chat/NodeHeader.tsx`: class
  `btn btn-small`, `data-testid="suggestions-toggle"`, `aria-pressed={showSuggestions}`, label
  "Suggestions" and title "Show suggested places to branch". Read the store after mount to avoid
  a hydration mismatch.
- [X] T022 [US2] In `src/components/chat/ChatView.tsx`, gate the suggestions effect and the prop
  on `showSuggestions`. When it's off, send no request and pass `NO_SUGGESTIONS`, so the marks
  disappear at once (FR-012). Keep the fetched map in state, so turning suggestions back on shows
  cached results without waiting.
- [X] T023 [US2] Check the order in `onListClick` against `contracts/ui.md`: marker, then term,
  then suggestion, then dragged selection ignored. Check that the term card's `pointerover` and
  lock behavior in `src/components/definitions/TermCard.tsx` still works on `.term-mark` segments
  that also carry `suggest-mark`. It should need no change, because it looks for `.term-mark`.

**Checkpoint**: both stories work. The three underline meanings are distinguishable and the
toggle works.

---

## Phase 5: Polish & Cross-Cutting

- [X] T024 [P] Extend `tests/integration/constitution.test.ts`:
  - every `span_suggestions.provenance` is `ai_suggested`
  - no file in `src/` matches `(updateTable|deleteFrom)\("span_suggestions"\)`
  - no file in `src/server/suggestions/` matches
    `insertInto\("(nodes|branch_markers|definitions|messages|node_summaries)"\)`
  - `span_suggestions` is only referenced from `src/server/suggestions/`, `src/server/db/` and
    migrations (FR-006)
- [X] T025 [P] Add a "Suggested underlines" note to `README.md`. It should explain what the grey
  dotted line means, the toggle, that it uses one low-effort AI call per reply the first time a
  conversation is opened with suggestions on, and that nothing is added to your map until you act.
- [X] T026 Manually check scenario 1 with `AI_PROVIDER=claude-code` (and `claude` if a key is
  available). Judge the quality of the suggestions and time SC-005. Record the timings in
  `research.md` R4.
- [X] T027 Full run: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`.

---

## Dependencies & Execution Order

- **Setup (T001–T002)**, then **Foundational (T003–T011)**, then **US1 (T012–T018)**, then
  **US2 (T019–T023)**, then **Polish (T024–T027)**.
- Inside Foundational:
  - T003, T004 and T007 can run in parallel.
  - T005 comes after T004. T006 comes after T005.
  - T008 comes after T005 and T007.
  - T009 comes after T006 and T007. T010 comes after T009. T011 comes after T003 and T010.
- **US1**: T014 comes before T015. T016 is independent. T017 is independent. T018 comes after
  T014, T015 and T016.
- **US2**: needs US1's rendering and click handling (T018). T020 comes before T021 and T022.
- US2 is not independent of US1 at the code level, since it refines US1's rendering. It is
  independently testable through scenarios 4 and 5.

## Parallel Examples

```text
Foundational: T003 (schemas.ts) ‖ T004 (provider.ts) ‖ T007 (locate.ts)
US1 tests:    T012 (integration) ‖ T013 (unit)
US1 impl:     T016 (selection.ts) ‖ T017 (globals.css) ‖ T014 (markerRanges.ts)
US2:          T019 (e2e spec) ‖ T020 (settingsStore.ts)
Polish:       T024 (constitution test) ‖ T025 (README)
```

## Implementation Strategy

- **MVP**: Phases 1–3. Suggestions appear on completed replies and hand off to the toolbar. Stop
  and validate with quickstart scenarios 1–3 and 6.
- **Increment 2**: Phase 4 adds the toggle and coexistence with markers and terms. It's needed
  before shipping, because FR-012 (Article IV) requires the toggle.
- **Finish**: Phase 5 adds the constitution guards, the README note, and a manual quality and
  timing check with a real AI setup.
