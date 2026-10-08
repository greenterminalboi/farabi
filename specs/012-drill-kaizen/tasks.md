---
description: "Task list for Feature 012: Drill Kaizen"
---

# Tasks: Drill Kaizen

**Input**: design documents in `specs/012-drill-kaizen/`: [spec.md](./spec.md), [plan.md](./plan.md),
[research.md](./research.md), [data-model.md](./data-model.md),
[contracts/http-api.md](./contracts/http-api.md),
[contracts/declarations.md](./contracts/declarations.md),
[contracts/drill-ui.md](./contracts/drill-ui.md) and [quickstart.md](./quickstart.md).

**Tests**: included, as in earlier features. Write each story's tests first and watch them fail.

**Format**: `[ID] [P?] [Story] Description`. `[P]` means the task can run in parallel, because it
touches different files and has no unfinished dependencies.

**Before starting**:

- Work only in the worktree `/Users/halda/Projects/farabi-012-drill` on branch `012-drill-kaizen`.
- Follow `farabi-coord/STATUS.md`:
  - Log when you finish a phase, get blocked, or change a shared contract.
  - Only the coordinator merges into `v0.2` and edits `src/server/db/migrationList.ts`.
- Read `node_modules/next/dist/docs/` for route handlers and dynamic pages before writing any route
  (`AGENTS.md`).
- Read user settings (the reply model) through `getSettings()` in
  `src/server/settings/settings.ts`, never `process.env` (STATUS 12:15).
- Tasks marked **⛔ C*n*** change a file another lane owns (research R15). Don't start one until the
  coordinator has OK'd that change in STATUS.md, and log it there when it's done.
- **Owner flags** (plan, post-design re-check): R3 (follow-up storage), R12 (link to the parent drill
  as a label) and R13 (rung names not selectable). If the owner rejects one, revise the affected
  tasks before that story starts.

---

## Phase 1: Setup

- [X] T001 Rebase `012-drill-kaizen` onto `v0.2` at `d0ac962` or later (migration 0010, v2 graph
  server, kind types with `shape`/`display`). Run `npm install` and
  `npx vitest run tests/integration`, and confirm it's green before any drill code. Log the rebase in
  STATUS.md.
- [X] T002 [P] Create the folders `src/server/drill/operations/`, `src/shared/kinds/drill/`,
  `src/drill/`, `src/app/drill/[drillId]/` and `src/app/api/drills/`. Add a one-line header comment to
  each first file, saying what lives there (plan Structure Decision).
- [X] T003 [P] Add `"0011_drill": m0011` to `src/server/db/migrationList.ts`. *(Changed by the coordinator at
  STATUS 12:40: migrationList.ts is committed in v0.2, so the entry is committed in this branch.)*

---

## Phase 2: Foundational (blocks every story)

### Pure core (D0, no shared files, can start before T001)

- [X] T004 [P] Write `tests/unit/f12-progression.test.ts` covering `levelChanges` and `roundPlan`
  from research R7:
  - all solved → +1, never above 10; none solved → −1, never below 1; mixed or partly → hold
  - a rung with no attempted problems → unchanged
  - flagged problems excluded
  - a newest open rung reaching `open_level` (default 4) opens the next non-removed locked rung in
    ladder order
  - level ≥ `solid_level` (default 7) → `solid`; every non-removed rung solid → `complete: true`
  - `roundPlan` gives ⌈n/2⌉ or more problems to the newest open rung, spreads the rest round-robin
    over older open or solid rungs lowest level first, allows at most one combined problem per round
    and only when both rungs are at level ≥ 5, and with a single open rung puts everything on it
  - every returned change lists the attempt ids behind it (FR-020)
- [X] T005 [P] Write `tests/unit/f12-results.test.ts` for the derived values in data-model.md:
  - problem result: newest override, else newest verdict, else `unattempted`
  - any `reveal` → `not_solved`; `solved` with a `hint` before its attempt → `partly_solved`
  - current problem: lowest `position` in the open round with no result, no `skip` and no `flag`
  - round note: a `recompute` change replaces the change it supersedes
- [X] T006 [P] Write `tests/unit/f12-operations.test.ts`:
  - `callOperation` extracts the first `{…}` (ignoring code fences) and validates it with the
    operation's zod schema
  - on invalid output it retries once with the validation error appended, then throws
    `AIUnavailableError`
  - each operation's schema accepts and rejects the shapes in contracts/declarations.md, for example
    `drill_ladder` with 1–12 rungs, and `drill_offer` with 0–3 picks whose `nodeId`s must be
    candidates
  - a guard reads `src/server/drill/operations/call.ts` and fails if it contains any operation id
    literal (`drill_ladder`, `drill_round`, `drill_verdict`, `drill_offer`, `drill_domain`)
  - the normalized-duplicate check (R8) lowercases, collapses whitespace and strips punctuation
- [X] T007 Implement `src/server/drill/progression.ts`: `levelChanges(round, results, ladder,
  levels, settings)` and `roundPlan(ladder, levels, settings)`. These are pure, with no imports from
  `db` or `ai` (R7). Makes T004 green.
- [X] T008 Implement `src/server/drill/results.ts`: `problemResult`, `currentProblem`, `roundNote`.
  These are pure, over plain row shapes. Makes T005 green.
- [X] T009 Implement `src/server/drill/operations/types.ts` (`DrillOperation<In, Out>` per
  contracts/declarations.md) and `src/server/drill/operations/call.ts`
  (`callOperation(op, input, { model })`, R5: JSON extraction, one retry, `AIUnavailableError`).
- [X] T010 [P] Implement `src/server/drill/operations/ladder.ts` (`drill_ladder` v1: rungs 1–12,
  basic → advanced, effort `medium`, maxTokens 2000).
- [X] T011 [P] Implement `src/server/drill/operations/round.ts` (`drill_round` v1: lessons for the
  rungs that need one, problems that fill the plan exactly, each with `hint` and `solution`; level
  descriptors from contracts/declarations.md "Instruction rules"; earlier problems each cut to 300
  characters; up to 6 recent mistakes with feedback; effort `medium`, maxTokens 8000), plus
  `normalizeProblem()` and `rejectDuplicates()` (R8).
- [X] T012 [P] Implement `src/server/drill/operations/verdict.ts` (`drill_verdict` v1: given problem,
  reference solution, attempt and whether hinted, returns `{verdict, feedback}`; the feedback must
  refer to the attempt and must not reveal the full solution; effort `low`, maxTokens 2000).
- [X] T013 [P] Implement `src/server/drill/operations/offer.ts` (`drill_offer` v1, candidate text cut
  to 1,500 characters) and `src/server/drill/operations/domain.ts` (`drill_domain` v1, reserved and
  unused by routes). Makes T006 green.

### Data, kinds and shared plumbing (D1, after T001)

- [X] T014 Write `src/server/db/migrations/0011_drill.ts` per data-model.md:
  - Add `'drill'` to the `nodes.origin` CHECK (drop and recreate the constraint in the same
    transaction).
  - `drills`: `domain text NOT NULL CHECK length 1..300`, `node_id uuid NOT NULL UNIQUE → nodes`,
    `domain_provenance provenance NOT NULL`, nullable `source_node_id → nodes`,
    `parent_drill_id → drills`, and `started_at` NULL → value once (trigger).
  - `drill_ladder_versions(rungs jsonb NOT NULL, provenance)`.
  - `drill_level_changes`: `from_level`/`to_level smallint CHECK 1..10`;
    `from_state`/`to_state CHECK IN ('locked','open','solid')`;
    `cause CHECK IN ('start','auto','recompute','manual')`; `evidence uuid[] NOT NULL DEFAULT '{}'`;
    `supersedes → drill_level_changes`.
  - `drill_round_ends(round_id PK, ended_by CHECK IN ('all_answered','user'))`.
  - `drill_problem_events(type CHECK IN ('hint','reveal','flag','skip','replaced'), detail jsonb)`.
  - `drill_verdict_overrides(verdict CHECK IN ('solved','partly_solved','not_solved'),
    provenance CHECK = 'user_authored')`.
  - `drill_attachments(action CHECK IN ('attach','detach'))`, with a trigger requiring `node_id` in
    the drill's project.
  - `drill_offers(drill_id UNIQUE, candidates jsonb, function_id, function_version,
    provenance CHECK = 'ai_suggested')`.
  - `drill_offer_events(type CHECK IN ('picked','dismissed'))`.
  - A `BEFORE UPDATE OR DELETE` raise trigger on every `drill_*` table, except the single
    `drills.started_at` NULL → value update.
  - Every `created_at` is `timestamptz NOT NULL DEFAULT clock_timestamp()`.
- [X] T015 Add the drill tables' Kysely types to `src/server/db/schema.ts`, appended after v0.2's
  `Database` entries. Don't reorder existing types.
- [X] T016 Add append-only guards to `tests/integration/constitution.test.ts`: UPDATE and DELETE on
  each `drill_*` table raise; `drills.started_at` can be set once and never again; there's no DELETE
  or PATCH export under `src/app/api/drill*`.
- [X] T017 **⛔ C1 (partial)** In `src/shared/kinds/types.ts`, add `onCanvas?: boolean` and
  `contextRole?: "user" | "ai"` to `NodeKindDeclaration`, and add `drill: "node"` to `Display` and
  `DISPLAY_SHAPE`. Set `contextRole` to `"user"` in `src/shared/kinds/question.ts` and to `"ai"` in
  `answer.ts`.
- [X] T018 [P] Create the nine drill kind declarations in `src/shared/kinds/drill/` (`start.ts`,
  `drill.ts`, `round.ts`, `lesson.ts`, `problem.ts`, `hint.ts`, `solution.ts`, `attempt.ts`,
  `verdict.ts`) with the shapes, displays, `onCanvas`, `contextRole` and strict property schemas from
  the data-model.md kinds table. The `drill` kind declares the settings `round_size` (1–10, default
  4), `open_level` (2–9, default 4) and `solid_level` (3–10, default 7). Register them in
  `src/shared/kinds/index.ts`.
- [X] T019 [P] Write `tests/unit/f12-registries.test.ts`: every drill kind registers; `display`
  matches `shape`; property schemas reject undeclared keys; `question` has role `user` and `answer`
  has role `ai`.
- [X] T020 **⛔ C4** Add optional `model`, `effort` and `maxTokens` to `CompletionInput` in
  `src/server/ai/provider.ts`, and honor them in `claude.ts` (`model`, `max_tokens`,
  `output_config.effort`) and `claudeCode.ts` (`--model`, effort). When they're absent, behavior is
  unchanged (R6).
- [X] T021 **⛔ C5** Add `registerFakeCompletion(tag, fn)` to `src/server/ai/fake.ts`: `complete()`
  uses a registered responder for `input.tag`, and otherwise keeps today's `Fake <tag> #n`.
- [X] T022 [P] Implement `src/server/drill/operations/fakes.ts` (R16), registered from the test setup
  and when `AI_PROVIDER=fake`:
  - ladder: 5 rungs `Rung 1…5`
  - round: fills the plan with `Problem r<round>-<i> on <rung> L<level>`, hint and solution
  - verdict: `solved` if the attempt contains `✓`, `partly_solved` if it contains `~`, otherwise
    `not_solved`, with feedback quoting the attempt
  - offer: picks the first ≤ 3 candidates
- [X] T023 Add the `drill` section to `src/shared/schemas.ts`: zod for `DrillSummary`, `Drill`,
  `DrillRound`, `DrillProblem`, `Rung`, `Verdict` and every request body in contracts/http-api.md.
  Append only.
- [X] T024 Implement `src/server/drill/load.ts`: `loadDrill(drillId)` assembles a `Drill` from
  `drills`, the newest ladder version, level changes, rounds (`drill_round` edges in creation order)
  with their lessons, problems, hints and solutions (shown only after their events), attempts,
  verdicts, overrides, follow-ups and the offer, using T008 for derived values. It returns 404 when
  the drill or its project is trashed. Also add `loadDrillSummaries(projectId)`.
- [X] T025 Implement the model choice for drill operations in `src/server/drill/model.ts`:
  `getSettings()` → `resolveReplyModel(replyModel)`, passed to every `callOperation` (FR-027).

**Checkpoint**: migrations apply on the test database (with the local T003 entry), and T004–T006,
T016 and T019 are green.

---

## Phase 3: User Story 1 - Start a drill on a domain (P1) 🎯 MVP

**Goal**: typing a domain creates a drill with an editable, ordered ladder. Starting it gives rung 1
a lesson and a first round at level 1.

**Independent Test**: create "Python dictionaries"; a ladder is proposed (ai-suggested); edit it;
start; rung 1 is open at level 1 with a lesson and 3–5 problems; a failing AI on create writes
nothing.

### Tests for User Story 1

- [X] T026 [P] [US1] In `tests/integration/f12-drill.test.ts` (`describe("US1")`):
  - create inserts the `drill_start` edge (`user_authored`, text = the domain), the `drill` node
    (origin `drill`), the `drills` row and an `ai_suggested` ladder version
  - fake fail mode → 503 and zero new rows in `drills`, `nodes` and `drill_ladder_versions`
  - a ladder edit writes a `user_authored` version
  - starting with an unchanged proposal writes a `user_confirmed` copy
  - start writes `start` changes (rung 1 `open` L1, others `locked`) and a round with one lesson for
    rung 1 and `round_size` problems
  - 409 `empty_ladder` and `already_started`
  - a domain over 300 characters → 400
- [X] T027 [P] [US1] Write `tests/e2e/f12-us1-start.spec.ts`: from the canvas, choose New drill, type
  the domain, see the ladder, rename and reorder a rung, Start, and see the lesson and the first
  problem (`drill-current-problem`).

### Implementation for User Story 1

- [X] T028 [US1] Implement `src/server/drill/create.ts` `createDrill({projectId, domain,
  sourceNodeId?, offerId?})`:
  - trim the domain and check 1..300
  - call `drill_ladder` first
  - then in one transaction insert the `drill_start` edge (origin `origin` in a new tree, or origin
    `drill` under `sourceNodeId`), the `drill` node (text `''`), the `drills` row and ladder version 1
    (`ai_suggested`, new rung uuids)
  - nothing is written on `AIUnavailableError`
- [X] T029 [US1] Implement `src/server/drill/ladder.ts` `saveLadder(drillId, rungs)`:
  - 1–20 rungs that aren't removed, names 1..120, rung ids unique, new rungs get ids
  - if any rounds exist, open and solid rungs keep their order, otherwise 409 `ladder_order_locked`
  - new rungs on a started drill get a `start` change as `locked`
  - writes a `user_authored` version
- [X] T030 [US1] Implement `src/server/drill/rounds.ts` `generateRound(drillId)`:
  - lock the drill row, 409 `round_open` if a round has no end
  - compute `roundPlan` (T007) and the rungs needing a lesson (just opened, no lesson yet)
  - call `drill_round`, reject duplicates and retry once (R8)
  - then in one transaction insert the `drill_round` edge (`ai_suggested`, origin `run`,
    `function_id`/`version`, properties `number`, `plan`) and its lesson, problem (`position` 0..n−1),
    hint and solution nodes (`problemId` links)
  - a short round records the shortfall in `note`
- [X] T031 [US1] Implement `src/server/drill/start.ts` `startDrill(drillId)`: 409 `already_started`
  or `empty_ladder`; write the `user_confirmed` copy if the newest version is the proposal; write
  `start` changes; set `started_at`; call `generateRound`.
- [X] T032 [US1] Add the routes `src/app/api/drills/route.ts` (GET `?projectId=` → summaries, POST
  create), `src/app/api/drills/[drillId]/route.ts` (GET), `…/ladder/route.ts`, `…/start/route.ts`
  and `…/rounds/route.ts`, wrapped in `withApi`, with error codes per contracts/http-api.md.
- [X] T033 [P] [US1] Implement `src/drill/store.ts` (zustand: the drill, pending action, last error)
  and the API calls in `src/lib/api.ts` (drill section).
- [X] T034 [P] [US1] Implement `src/drill/CreateDrillForm.tsx`: domain input, keeps the typed text on
  error with Retry (Story 1 AS4), prefill support for offers (US6).
- [X] T035 [P] [US1] Implement `src/drill/Ladder.tsx`: rungs with state and level; before start,
  edit, reorder, remove, add, then Start; after start, edit with locked-order rules; AI tag on
  `ai_suggested` versions.
- [X] T036 [US1] Implement `src/drill/LessonView.tsx` and the first version of
  `src/drill/DrillScreen.tsx` with header (domain, Back to canvas), ladder, lesson and current
  problem text. Add `src/app/drill/[drillId]/page.tsx` rendering it. Element text goes through v0.2's
  `RichText` and `render` with `data-node-id` (R14).
- [X] T037 [US1] Add a temporary **New drill** entry on the canvas that opens `CreateDrillForm` and
  navigates to `/drill/:id`. If C3 isn't approved yet, put it on the project menu in
  `src/components/common/ProjectMenu.tsx` and move it in T068.

**Checkpoint**: US1 is independently testable (T026 and T027 green).

---

## Phase 4: User Story 2 - Attempt a problem and get feedback (P1)

**Goal**: answer one problem at a time, get an AI verdict with feedback, and use hint, solution, try
again, skip and override.

**Independent Test**: answer one problem right and one wrong; both get verdicts; a second attempt is
added beside the first; an override keeps both verdicts.

### Tests for User Story 2

- [X] T038 [P] [US2] In `tests/integration/f12-drill.test.ts` (`describe("US2")`):
  - an attempt inserts a `drill_attempt` edge (`user_authored`, origin `ask`, text set,
    `sent_at` set) then a `drill_verdict` node (`ai_suggested`, origin `run`, properties `verdict`,
    `hinted`)
  - verdict fail → the attempt stays, 503 `verdict_unavailable` with `attemptId`; judge retry adds
    the verdict; 409 `already_judged`
  - attempt text over 20,000 characters → 400; an attempt on a flagged problem → 409
  - hint, reveal and skip events; result rules (reveal → `not_solved`, hinted solve →
    `partly_solved`)
  - an override inserts a `user_authored` row and keeps the AI verdict
  - UPDATE on the attempt row is rejected by `nodes_guard`
- [X] T039 [P] [US2] Write `tests/e2e/f12-us2-attempt.spec.ts`: submit `✓`, see solved; submit wrong,
  see not solved; Try again; Hint; Show solution; Override; and only the current problem is open,
  with earlier ones reopenable from the round strip.

### Implementation for User Story 2

- [X] T040 [US2] Implement `src/server/drill/attempts.ts`:
  - `submitAttempt(problemId, text)`: check 1..20,000, not flagged; insert the attempt edge; call
    `drill_verdict` with the problem, its solution node text and whether there's a hint event; insert
    the verdict
  - `judgeAgain(attemptId)`
  - return `roundEnded` hints for the client (all problems have results)
- [X] T041 [P] [US2] Implement `src/server/drill/events.ts` `recordProblemEvent(problemId,
  {type, reason?})` for `hint`, `reveal`, `skip` and `flag`, with no AI call (R9).
- [X] T042 [P] [US2] Implement `src/server/drill/overrides.ts` `overrideVerdict(verdictId, verdict)`.
  The recompute part is added in T052.
- [X] T043 [US2] Add the routes `src/app/api/drill-problems/[problemId]/attempts/route.ts`,
  `…/events/route.ts`, `src/app/api/drill-attempts/[attemptId]/judge/route.ts` and
  `src/app/api/drill-verdicts/[verdictId]/override/route.ts`.
- [X] T044 [US2] Implement `src/drill/ProblemView.tsx`: problem text, answer box, Submit, Hint, Show
  solution, Flag, Skip; after a verdict, the verdict badge, feedback, Override, Try again and Next;
  both verdicts shown when overridden, with the user's marked as counting; the AI tag on AI items;
  "Judge again" on a missing verdict.
- [X] T045 [US2] Implement `src/drill/RoundStrip.tsx` (one chip per problem with its result, click to
  reopen) and the one-at-a-time flow in `DrillScreen.tsx` using `currentProblemId` (FR-009, R11).

**Checkpoint**: US1 and US2 work independently.

---

## Phase 5: User Story 3 - Climb the ladder automatically (P1)

**Goal**: ending a round moves levels automatically, opens the next rung with a lesson, mixes review
problems in, and explains every change.

**Independent Test**: solve all of rung 1 for rounds until it reaches level 4; rung 2 opens with a
lesson; the next round is mostly rung 2; failing a whole round drops a level; notes cite attempts.

### Tests for User Story 3

- [X] T046 [P] [US3] In `tests/integration/f12-drill.test.ts` (`describe("US3")`):
  - SC-002 scripted run with the fake `✓`: +1 per round, rung 2 opens the round after rung 1 hits 4,
    and every `auto` change has non-empty `evidence`
  - none solved → −1
  - user end with unattempted problems → no change for those rungs
  - an override after the end writes `recompute` rows with `supersedes`, and later rounds are
    untouched
  - SC-003: 10 rounds, no repeated normalized problem text
  - end then a failing next round → the end and changes are kept, `nextRoundError` is returned, and
    POST rounds retries
- [X] T047 [P] [US3] Write `tests/e2e/f12-us3-climb.spec.ts`: answer a full round, see the note and an
  automatic next round, reach the opening level, see the rung 2 lesson and a mixed round.

### Implementation for User Story 3

- [X] T048 [US3] Implement `src/server/drill/rounds.ts` `endRound(roundId, by)`:
  - lock the drill; 409 if already ended
  - insert `drill_round_ends`
  - compute results (T008) and `levelChanges` (T007), and insert them as `auto` (`ai_suggested`,
    `evidence`, `round_id`)
  - if the drill is now complete, call `createOffer` (US6, a no-op until T077)
  - then `generateRound`; on failure return `nextRoundError` and keep everything written
- [X] T049 [US3] Add the route `src/app/api/drill-rounds/[roundId]/end/route.ts`.
- [X] T050 [US3] In `DrillScreen.tsx`:
  - call end automatically once every problem has a result (`all_answered`)
  - add an End round button (`user`)
  - show the round note (from/to, state changes, evidence links to attempts) and a "Generate next
    round" retry on `nextRoundError`
- [X] T051 [US3] Show the lesson automatically when a round contains a lesson for a newly opened
  rung, dismissible and reachable from its rung in `Ladder.tsx` (FR-006).
- [X] T052 [US3] Extend `overrideVerdict` in `src/server/drill/overrides.ts`: when the verdict's round
  has ended, recompute that round's `levelChanges` and insert `recompute` rows that supersede the
  differing `auto` rows (FR-021).
- [X] T053 [P] [US3] Implement `src/server/drill/levels.ts` `setLevel(drillId, rungId,
  {level?, state?})`: a `manual` change, `user_authored`, level 1..10. Add the route
  `src/app/api/drills/[drillId]/rungs/[rungId]/level/route.ts` and the ladder control in
  `Ladder.tsx`.

**Checkpoint**: all P1 stories work. This is the MVP (D1 and D2).

---

## Phase 6: User Story 4 - See progress and come back later (P2)

**Goal**: reopen a drill and see each rung's state and level history, failed problems and the
unfinished round, and redo a failed problem.

**Independent Test**: three rounds, restart, reopen from the canvas, and everything is intact; Redo
adds an attempt that counts toward the current round.

### Tests for User Story 4

- [X] T054 [P] [US4] In `tests/integration/f12-drill.test.ts` (`describe("US4")`):
  - SC-005: after `drainGenerations()` and a fresh `loadDrill`, ladder, levels, rounds, attempts and
    the open round are identical
  - a redo attempt on an earlier-round problem counts toward the current round for its rung in
    `endRound`
  - level history has one entry per round per rung
- [X] T055 [P] [US4] Write `tests/e2e/f12-us4-resume.spec.ts`: run 3 rounds, reload the page, reopen
  from the canvas card or project menu, check the sparkline and failed list, Redo one.

### Implementation for User Story 4

- [X] T056 [US4] In `endRound` (T048), count redo attempts made during the open round toward their
  rung's results for that round. Document this rule in a comment that cites FR-023 AS2.
- [X] T057 [P] [US4] Implement `src/drill/FailedList.tsx` (open `not_solved` and `partly_solved`
  problems from earlier rounds, each with Redo, which opens it in `ProblemView`).
- [X] T058 [P] [US4] Add the per-rung level sparkline (level after each round, from `Rung.history`)
  to `src/drill/Ladder.tsx`.
- [X] T059 [US4] Make the screen resume on load: select `currentProblemId` of the open round, or show
  the "Generate next round" retry if the last round ended without a successor.

**Checkpoint**: US1–US4 work.

---

## Phase 7: User Story 5 - Ask why, and branch out (P2)

**Goal**: a follow-up from a problem becomes a canvas branch off the drill node, with the problem,
attempt and verdict as context; Branch, Define and Park work on drill text; the drill's state never
changes.

**Independent Test**: follow up on a judged problem; a question edge and streaming answer appear
leaving the drill card; its context includes problem, attempt and verdict; the problem links to it;
no level changes. Then Define and Branch from a lesson.

### Tests for User Story 5

- [X] T060 [P] [US5] Write `tests/integration/f12-followups.test.ts`:
  - `POST /api/nodes/:verdictId/ask` creates a `question` edge under the verdict
  - `buildReplyInput` for its answer has turns, in order: domain (user), problem (ai), attempt
    (user), verdict feedback (ai), follow-up (user)
  - a follow-up on an unattempted problem has its parent at the problem
  - a branch with an anchor in problem text validates against the problem's text
  - Define and Park on lesson text succeed
  - before and after counts of every `drill_*` table are equal
- [X] T061 [P] [US5] Write `tests/e2e/f12-us5-followup.spec.ts`: send a follow-up, see the link under
  the problem, follow it to the canvas focused on the edge drawn from the drill card, return to the
  same problem; then Define a phrase in a lesson.

### Implementation for User Story 5

- [X] T062 [US5] **⛔ C2** In `src/server/graph/context.ts`, replace the literal `question`/`answer`
  checks with `getKind(el.kind).contextRole`. User turns need non-null text; AI turns need non-null
  text and, when `status` is non-null, `status = 'complete'`. Anchor text stays from edges with
  `anchor_text`. Existing v0.2 context tests must stay green unchanged.
- [X] T063 [US5] **⛔ C3 (server)** In `src/server/graph/canvas.ts`:
  - leave out elements of kinds with `onCanvas === false`
  - for each sent element whose parent was left out, set `drawnFrom` to the nearest sent ancestor
  - add `drills: DrillSummary[]` from `loadDrillSummaries`
  - add `drawnFrom` and `drills` to `CanvasResponse` in `src/shared/schemas.ts`
- [X] T064 [US5] **⛔ C3 (client)** In `src/canvas/` (graph build and layout), treat `drawnFrom` as
  the parent for layout and connectors. Add the `drill` display card (domain, "Rung n: ‹name› ·
  level L" or "Complete", "from ‹parent›", Open), and Open navigates to `/drill/:drillId`. Test id
  `drill-card`.
- [X] T065 [US5] Add the follow-up box to `src/drill/ProblemView.tsx` (`drill-followup`):
  - it posts to v0.2's ask route on the newest verdict, or on the problem when there's none
  - it lists `followUps` links that open `/?project=…&focus=<edgeId>&returnTo=/drill/<id>#<problemId>`
  - back on the canvas, `returnTo` shows a "Back to drill" button
- [X] T066 [US5] Mount v0.2's `SelectionToolbar` on the drill screen so selections inside any
  `data-node-id` element offer Branch, Define and Park. A branch stays on the drill screen and adds a
  link under the problem (FR-026). Rung names are excluded (R13).
- [X] T067 [US5] In `src/server/drill/load.ts`, compute `followUps` per problem: question edges whose
  parent is one of that problem's verdicts, or the problem itself.
- [X] T068 [US5] Move the **New drill** entry into the canvas "new" menu per contracts/drill-ui.md, if
  T037 used the project menu.

**Checkpoint**: US1–US5 work. Drill text is fully part of the map.

---

## Phase 8: User Story 6 - Ground a drill in my conversations and drill on from it (P3)

**Goal**: attach project conversations to a drill as AI input; on completion, offer up to 3 next
drills from the drill's own follow-ups and attachments; picking one starts a linked drill.

**Independent Test**: attach a conversation and see the next round record `readAttachments`; mark
every rung solid and end a round; at most 3 offers come only from follow-ups and attachments; pick
one → a new drill under that node with the parent drill linked; dismiss → never shown again.

### Tests for User Story 6

- [X] T069 [P] [US6] In `tests/integration/f12-drill.test.ts` (`describe("US6")`):
  - attach and detach rows; attaching a node from another project → 409 `wrong_project`
  - attaching triggers no AI call (fake call count unchanged)
  - the round prompt includes the attached path, and problems record `readAttachments`; a detached
    one is no longer read
  - on completion with candidates, one `drill_offer` call and a `drill_offers` row with ≤ 3 items,
    all from candidates; with no candidates, no call and no row
  - pick → `createDrill` with `sourceNodeId` puts the `drill_start` edge (origin `drill`) under the
    source, sets `parent_drill_id` and records `picked`
  - dismiss hides the offer for good
  - adding a rung to a complete drill reopens it
- [X] T070 [P] [US6] Write `tests/e2e/f12-us6-drill-on.spec.ts`: attach from the drill header, set
  every rung solid with the manual control, end the round, see the offers, Drill this, see the
  prefilled domain, create, see the new card on the canvas under its source with "from …".

### Implementation for User Story 6

- [X] T071 [US6] **⛔ C6** In `src/server/settings/kindSettings.ts`, generalize overrides from
  function edges to any element (`setElementSetting(elementId, key, value)`, keeping
  `setEdgeSetting` as a wrapper) and check `open_level < solid_level` for the `drill` kind on save.
  Make the existing `/api/kind-settings` route accept a `nodeId`.
- [X] T072 [US6] Read drill settings through `resolvedValues("drill", drillNodeId)` in
  `generateRound` and `endRound` instead of the declared defaults, and add a settings panel to the
  drill screen header.
- [X] T073 [US6] Implement `src/server/drill/attachments.ts` `setAttachment(drillId, nodeId, action)`
  (same project, live, no AI) and `attachedPaths(drillId)` (the root-to-node path via v0.2's
  `ancestorPath`). Add the route `src/app/api/drills/[drillId]/attachments/route.ts`.
- [X] T074 [US6] Pass `attachedPaths` into `drill_ladder` (create, when attachments exist; none on
  first create) and `drill_round`, and record `readAttachments` on lesson and problem nodes (FR-031).
- [X] T075 [P] [US6] Add the attachments UI to the drill header: list with excerpts, Detach, and
  "Attach from canvas", which navigates to the canvas in pick mode and returns with the node id.
- [X] T076 [US6] Implement `src/server/drill/offers.ts`:
  - `createOffer(drillId, roundId)` gathers candidates (question edges in the drill's tree whose path
    passes through a drill element, plus attached nodes), skips when there are none, calls
    `drill_offer`, inserts `drill_offers`
  - `dismissOffer(offerId)`
  - `recordPick(offerId, nodeId, newDrillId)`
- [X] T077 [US6] Wire `createOffer` into `endRound` (T048). Add `src/app/api/drill-offers/[offerId]/dismiss/route.ts`
  and handle `offerId`/`sourceNodeId` in POST `/api/drills` via `createDrill` and `recordPick`.
- [X] T078 [P] [US6] Implement `src/drill/OfferCards.tsx`: "Ladder complete", up to 3 cards (Drill
  this → `CreateDrillForm` prefilled with the domain, Dismiss), AI tag, hidden after dismiss.
- [X] T079 [US6] Show "from ‹parent›" on the drill card (T064) and in the drill header when
  `parentDrill` is set (R12).

**Checkpoint**: all six stories work.

---

## Phase 9: Polish and hand-off

- [X] T080 [P] Add a **Drills** section to `README.md`: creating a drill, how levels move (up one,
  hold, down one), rungs opening at level 4 and turning solid at 7, follow-ups going to the canvas,
  attachments and the completion offer.
- [X] T081 [P] Check every drill AI call path against FR-027 with a test in
  `tests/integration/f12-drill.test.ts`: GET routes, ladder edits, events, attachments, overrides
  and settings saves make zero fake `complete` calls.
- [ ] T082 *(load measured: 5–7 ms, see quickstart.md; the real-provider verdict latency is still open)* Measure drill screen load for a 30-round seeded drill (target < 500 ms, plan Performance
  Goals) and the verdict latency with a real provider (SC-004, ≤ 15 s p95 over 20 attempts). Record
  both in `specs/012-drill-kaizen/quickstart.md`.
- [ ] T083 *(open: needs a real provider and the owner)* Run quickstart §2–§4 with `AI_PROVIDER=claude-code` on the "Python dictionaries" drill and
  note the SC-006 owner check.
- [X] T084 Run the full suite (`npx vitest run`, `npx playwright test`) on the rebased branch, then
  log the hand-off in STATUS.md: the commit hash, C1–C6 done, and the C7 reminder for the coordinator
  merge.

---

## Dependencies and execution order

- **Phase 1** first. T002 can run before T001.
- **Pure core (T004–T013)** can start immediately, on bbd6930, before the rebase.
- **The rest of Phase 2 (T014–T025)** needs T001, and T017, T020 and T021 also need coordinator
  approval. It blocks every story.
- **US1 → US2 → US3** in order. US2 needs rounds (T030), and US3 needs attempts (T040). Together they
  are the MVP.
- **US4** needs US3 (T048).
- **US5** needs US2 (verdicts to follow up on) and v0.2 M3/M4 (canvas, text layer), plus C2 and C3.
- **US6** needs US3 (completion) and US5 (follow-ups as candidates), plus v0.2 M6 and C6.
- **Polish** last.

```text
Setup ─▶ Foundational ─▶ US1 ─▶ US2 ─▶ US3 ─┬─▶ US4
          (pure core can start now)        ├─▶ US5 ─▶ US6
                                           └──────────┘
```

## Parallel examples

- **Foundational**: T004, T005, T006 together; then T010, T011, T012, T013 together after T009;
  T018, T019, T022 together after T017.
- **US1**: T026 and T027 together; T033, T034, T035 together while T028–T032 are in progress.
- **US2**: T038 and T039 together; T041 and T042 together.
- **US4**: T057 and T058 together.
- **US6**: T075 and T078 together after T076.

## Implementation strategy

1. **Now**: T002 and the pure core T004–T013. These touch no shared files and need no approval.
2. **After v0.2 commit `d0ac962` and the coordinator's OK on C1, C4 and C5**: T001 rebase, then the
   rest of Phase 2.
3. **MVP**: US1–US3. A full drill loop on its own screen, reachable from the project menu. Demo it
   to the owner, then decide on the R3, R12 and R13 flags.
4. **Increment**: US4 (resume), then US5 once v0.2's text layer lands, then US6 once M6 lands.
5. Log each checkpoint in STATUS.md. The coordinator merges.
