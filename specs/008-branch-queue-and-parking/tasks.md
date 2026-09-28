---
description: "Task list for Branch Queue (Parked Tangents & Branches Panel)"
---

# Tasks: Branch Queue (Parked Tangents & Branches Panel)

**Input**: design documents in `specs/008-branch-queue-and-parking/`: [spec.md](./spec.md),
[plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/http-api.md](./contracts/http-api.md), [contracts/ui.md](./contracts/ui.md) and
[quickstart.md](./quickstart.md).

**Tests**: included, as in earlier features. The quickstart scenario numbers ("QS n") map to the
test tasks.

**Format**: `[ID] [P?] [Story] Description`. `[P]` means the task can run in parallel, because it
touches different files and has no unfinished dependencies.

---

## Phase 1: Setup

- [X] T001 Create the migration `src/server/db/migrations/0007_parked_tangents.ts`, per
  data-model.md. Follow `0006_information_pressure.ts`: forward-only, with a `down()` that throws.
  1. `CREATE TABLE parked_tangents` with these columns:
     - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
     - `node_id uuid NOT NULL REFERENCES nodes(id)`
     - `message_id uuid NOT NULL REFERENCES messages(id)`
     - `start_offset integer NOT NULL`, `end_offset integer NOT NULL`,
       `CHECK (start_offset >= 0 AND start_offset < end_offset)`
     - `anchor_text text NOT NULL CHECK (btrim(anchor_text) <> '')`
     - `prefix text NOT NULL`, `suffix text NOT NULL`
     - `provenance provenance NOT NULL DEFAULT 'user_authored' CHECK (provenance = 'user_authored')`
     - `created_at timestamptz NOT NULL DEFAULT now()`

     Use the same FK delete behavior `branch_markers` uses in `0001_initial.ts`.
  2. Create two indexes: `parked_tangents_by_node ON parked_tangents (node_id, created_at DESC, id DESC)`
     and `parked_tangents_by_message ON parked_tangents (message_id)`.
  3. `CREATE TABLE parked_tangent_events` with these columns:
     - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
     - `tangent_id uuid NOT NULL REFERENCES parked_tangents(id)`
     - `kind text NOT NULL CHECK (kind IN ('question_set', 'discarded', 'fired'))`
     - `question text NULL`
     - `child_node_id uuid NULL REFERENCES nodes(id)`
     - `provenance provenance NOT NULL DEFAULT 'user_authored' CHECK (provenance = 'user_authored')`
     - `created_at timestamptz NOT NULL DEFAULT now()`

     Add these table checks:
     - `CHECK (question IS NULL OR kind = 'question_set')`
     - `CHECK (question IS NULL OR btrim(question) <> '')`
     - `CHECK ((kind = 'fired') = (child_node_id IS NOT NULL))`
  4. Create `parked_events_latest ON parked_tangent_events (tangent_id, created_at DESC, id DESC)`
     and `CREATE UNIQUE INDEX parked_events_terminal ON parked_tangent_events (tangent_id) WHERE kind IN ('discarded', 'fired')`.
  5. Create the function `parked_append_only()`, which raises
     `'% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP`. Attach it to both tables with a
     trigger `<table>_append_only` BEFORE UPDATE OR DELETE FOR EACH ROW.
- [X] T002 In `src/server/db/schema.ts`:
  - Add `ParkedTangentsTable`. `provenance` is `ColumnType<Provenance, never, never>`, and
    `created_at` is `CreatedAt`.
  - Add `ParkedTangentEventsTable` with `export type ParkedEventKind = "question_set" | "discarded" | "fired"`.
    `question` and `child_node_id` are `string | null`, and `provenance` is
    `ColumnType<Provenance, never, never>`.
  - Register both tables in `Database` as `parked_tangents` and `parked_tangent_events`.
- [X] T003 Run `npm run db:migrate` and `npm run db:migrate -- --test`. Add
  `parked_tangent_events, parked_tangents` to the start of both TRUNCATE lists, in
  `tests/integration/setup.ts` and in `tests/e2e/helpers.ts` (`resetDb`).

---

## Phase 2: Foundational (blocks all stories)

- [X] T004 [P] Add to `src/shared/schemas.ts`:
  - `ParkedTangent = z.object({ id: z.string(), nodeId: z.string(), anchor: Anchor, question: z.string().nullable(), createdAt: z.string() })`
  - `children: z.array(MapNode)` and `parked: z.array(ParkedTangent)` on `NodeView`
  - `ParkRequest = Anchor.extend({ question: z.string().nullable().optional() })`
  - `ParkedQuestionRequest = z.object({ question: z.string().nullable() })`
  - `ParkedResponse = z.object({ parked: ParkedTangent })`
  - `DiscardParkedResponse = z.object({ discarded: z.object({ id: z.string() }) })`
  - `FireParkedResponse`, a `z.discriminatedUnion("kind", …)` with two members:
    `{ kind: "sent", node: MapNode, marker: Marker, userMessage: Message, aiMessage: Message }` and
    `{ kind: "preload", node: MapNode, marker: Marker, draft: z.string() }`
- [X] T005 [P] Refactor `src/server/forest/branch.ts` without changing behavior:
  - Export `validateAnchor(trx, nodeId, anchor)`. It contains the existing parent lookup and every
    existing check, and returns `{ parent, message }`. It throws the same `NotFoundError`,
    `InvalidSelectionError` and `ConflictError("message_not_branchable", …)` as today.
  - Export `insertBranch(trx, parent, message, anchor)`. It inserts the node and a
    `kind: "selection"` marker, with prefix and suffix computed from `message.content` as today,
    and returns `{ child, marker }`.
  - `createBranch` becomes a transaction calling both helpers. Its response is unchanged.
  - `tests/integration/us2-branching.test.ts` must pass unchanged.
- [X] T006 [P] Refactor `src/server/messages/send.ts` without changing behavior:
  - Export `insertUserTurn(trx, nodeId, content)`. It holds the body of `sendOrdinary`'s
    transaction: the node `forUpdate` lookup, the `reply_in_progress` conflict, the seq, the
    user-message insert and `insertPendingReply`. It returns `{ userMessage, pending }`.
  - `sendOrdinary` calls it inside its transaction and then `void generate(nodeId, pending.id)` as
    today.
  - The existing send and quick-branch tests must pass unchanged.
- [X] T007 Create `src/server/parked/state.ts`. It is the only place that derives parked status
  (data-model.md "Derived state").
  - `lockTangent(trx, id)`: `selectFrom("parked_tangents").selectAll().where("id", "=", id).forUpdate()`.
    It throws `NotFoundError("Parked item not found")` when there is no row, and
    `ConflictError("parked_consumed", "This parked item was already used or discarded")` when a
    `discarded` or `fired` event exists.
  - `currentQuestion(trx, id)`: the latest `question_set` event's `question`, ordered by
    `created_at DESC, id DESC`, or null.
  - `liveParked(nodeId)`: the node's tangents with no terminal event, ordered
    `created_at DESC, id DESC`, each with its current question. Use one query with `NOT EXISTS`
    and a lateral or `DISTINCT ON` lookup of the latest `question_set`.
  - `hasLiveParkedOn(trx | db, messageId)`: boolean.
  - `normalizeQuestion(q: string | null | undefined)`: returns null when `q` is null, undefined or
    `q.trim() === ""`. Otherwise it returns `q` unchanged, not trimmed (FR-012 "unchanged").
- [X] T008 Add `toParkedTangent(row, question)` to `src/server/mappers.ts`. It maps a
  `parked_tangents` row to `ParkedTangent`, with `anchor` built from message_id, the offsets,
  anchor_text, prefix and suffix.
- [X] T009 Extend `getNodeView` in `src/server/forest/nodeView.ts`. Add to its `Promise.all`:
  - The direct children: `nodes` where `parent_id = nodeId`, ordered `created_at DESC, id DESC`
    (FR-002, R10). Map each with `toMapNode(child, anchorText, toSummary(latest, anchorText), null, messageCount)`,
    reusing incoming-marker anchor text, the latest summary and the live message count. Batch these
    lookups with `IN (childIds)`, not per child.
  - `liveParked(nodeId)`, mapped with `toParkedTangent`.

  Return both as `children` and `parked`. Update any test fixtures that build `NodeView` literals
  (`grep -rn "canRegenerate" tests src/lib`).
- [X] T010 [P] Add `branchPanelOpen: boolean` (default `true`) and `setBranchPanelOpen` to
  `src/state/settingsStore.ts`, and include it in `partialize` (R7).
- [X] T011 Build the panel shell.
  - **ChatView**: `src/components/chat/ChatView.tsx` returns the chat `<section>` and
    `<BranchPanel view={view} reload={load} />` as siblings in `.main`'s flex row (research R7, as
    built).
  - **BranchPanel**: create `src/components/chat/BranchPanel.tsx`, per contracts/ui.md:
    - `<aside aria-label="Branch queue" data-testid="branch-panel">`
    - a `role="tablist"` with "Branches {n}" and "Parked {n}" tabs; the selected tab is
      `viewStore.panelTab`, so other components can open the Parked tab
    - the "Hide branch panel" / "Show branch panel" toggle, bound to `branchPanelOpen`
  - **CSS** in `src/app/globals.css`:
    - `.branch-panel`: a 300px column, 260px below 1100px wide
    - `@media (max-width: 640px)`: an overlay at z-index 15, under the feedback drawer's 20
    - tab styles
    - collapsed: a slim toggle strip
- [X] T012 Register the new routes in `tests/integration/helpers.ts`:
  - `/^\/api\/nodes\/([^/]+)\/parked$/` with key `nodeId`
  - `/^\/api\/parked\/([^/]+)\/question$/`, `/^\/api\/parked\/([^/]+)\/discard$/` and
    `/^\/api\/parked\/([^/]+)\/fire$/`, each with key `id`

  They point to the route files created in T015, T024, T034 and T035.

**Checkpoint**: `GET /api/nodes/{id}` returns `children` and `parked: []`. The panel renders
empty tabs beside the chat. Every existing test passes.

---

## Phase 3: User Story 1 — Park a tangent (P1) 🎯 MVP

**Goal**: Park in the toolbar, with the optional question form. Branch uses the same form and
preloads its composer. Parked items show in the Parked tab.

**Independent test**: QS 1–4, 10, 13 and 14.

### Tests for User Story 1

- [X] T013 [P] [US1] Integration tests in the new file `tests/integration/f8-parked.test.ts`
  (`describe("US1 park")`), using `call()`, which covers QS 1–4, 10 and 14:
  - **Park without a question**: `POST /api/nodes/{id}/parked` with a valid anchor returns 201.
    The node count is unchanged, and so are `branch_markers` and `messages`. `NodeView.parked` has
    one item with `question: null`.
  - **With a question**: `question: "How does this scale?"` round-trips exactly. `"   "` is stored
    as `null`. `"  keep  spaces "` is returned unchanged.
  - **Invalid anchors**: a mismatched text gives 422 `invalid_selection`. A message from another
    node gives 422. A pending message gives 409 `message_not_branchable`.
  - **Independent records**: park the same span twice, then `POST …/branches` on it. There are two
    parked items and one child, all independent.
  - **Regenerate guard** (R6): park on the latest AI reply. `canRegenerate` is null, and
    `POST /api/messages/{id}/regenerate` gives 409 `has_parked`.
- [X] T014 [P] [US1] E2E tests in the new file `tests/e2e/f8-branch-queue.spec.ts`
  (`test.describe("US1")`), which covers QS 1, 3 and 13:
  - Select a phrase with `selectInLastAiMessage`. Click the toolbar's "Park", then press Enter in
    "Your question (optional)". `parked-notice` appears, the URL is unchanged, the Parked tab
    lists one `parked-item` with the anchor text, and the composer text is unchanged.
  - Click Park and then press Escape. The Parked count stays the same.
  - Click Branch, type "Why?" and press Enter. The new node's composer (`getByLabel("Message")`)
    has the value "Why?". Branch again with a blank field: the composer has the anchor phrase.

### Implementation for User Story 1

- [X] T015 [US1] Create `src/server/parked/park.ts` with `parkTangent(nodeId, body: ParkRequest)`:
  - `assertId` the node and message ids.
  - In a transaction, call `validateAnchor(trx, nodeId, anchor)`. Insert a `parked_tangents` row
    with prefix and suffix taken from the request anchor, the same as Branch.
  - If `normalizeQuestion(body.question)` is non-null, insert a `question_set` event.
  - Return `{ parked: toParkedTangent(row, question) }`.

  Create `src/app/api/nodes/[nodeId]/parked/route.ts`: a `POST` via `withApi` and
  `readJson(req, ParkRequest)` that returns status 201.
- [X] T016 [US1] Implement the regenerate guard (R6):
  - In `src/server/messages/regenerate.ts`, after the existing `has_branches` check, throw
    `ConflictError("has_parked", "This reply has parked tangents, so it can't be regenerated")`
    when `hasLiveParkedOn(trx, old.id)`.
  - In `src/server/forest/nodeView.ts`, `canRegenerate` also requires that no live parked item
    has `anchor.messageId === latest.id`. Use the `parked` list already loaded.
- [X] T017 [P] [US1] Add `park: (nodeId, anchor, question) => request("POST", `/api/nodes/${nodeId}/parked`, ParkedResponse, { ...anchor, question })`
  to `src/lib/api.ts`.
- [X] T018 [US1] Rework `src/components/chat/BranchAction.tsx`, per contracts/ui.md:
  - **Step 1**: add a third button, `<span aria-hidden="true">🅿</span> Park`, titled "Save this
    text as a tangent for later".
  - **Step 2**: clicking Branch or Park sets `form: { action: "branch" | "park", anchor, question: "" }`.
    - While `form` is set, the `selectionchange` handler must not clear or replace the pending
      state (frozen anchor).
    - Render `data-testid="branch-question-form"` with an input labelled "Your question
      (optional)" (`autoFocus`), a submit button named exactly "Branch" or "Park", and a "Cancel"
      button.
    - Enter submits and Escape cancels. Cancelling resets `form` and `pending` and writes nothing.
    - Only the step-1 wrapper keeps the existing `onMouseDown` `preventDefault`, so the input can
      be focused.
  - **Branch submit**: `api.branch(nodeId, anchor)`, then
    `useViewStore.getState().setDraft(node.id, question.trim() ? question : anchor.text)`, then
    `router.push` (FR-009, FR-010).
  - **Park submit**: `api.park(nodeId, anchor, question)`. Then clear the selection and the form,
    show a toast (`data-testid="parked-notice"`) "Parked · View" for 4s, where "View" opens the
    Parked tab (T011 mechanism), and ask ChatView to reload. Add an `onParked` prop that ChatView
    passes as `load`.
  - Errors go through `onError`, as today.
  - Add styles for `.highlight-toolbar form`, `.highlight-toolbar input` in `src/app/globals.css`.
- [X] T019 [US1] Fill the Parked tab in `src/components/chat/BranchPanel.tsx`
  (`data-testid="parked-tab"`):
  - Each `view.parked` item is an `<li data-testid="parked-item">`. It shows the quoted anchor
    text and, below it, the question or the muted text "No question: opens with the highlighted
    text".
  - When the list is empty, show `data-testid="parked-empty"`: "Nothing parked. Select text and
    choose Park to save a tangent for later."
  - Actions come in US2 and US4.
- [X] T020 [US1] Update the existing e2e tests for the two-step Branch:
  - In `tests/e2e/helpers.ts` `branchOn`, after clicking "Branch", press Enter in "Your question
    (optional)", or click the form's "Branch" button.
  - Do the same in `tests/e2e/us2-branch.spec.ts` (line ~26) and `tests/e2e/f5-suggestions.spec.ts`
    (lines ~33 and ~88). Scope the button to the form, so the step-1 "Branch" button isn't matched
    twice.
  - Assertions that the composer is empty in a new branch now expect the anchor text instead
    (FR-010). Find them with `grep -rn 'getByLabel("Message")' tests/e2e`.

**Checkpoint**: Park works end to end. Branch preloads the composer. The Parked tab lists items.
All older e2e tests pass.

---

## Phase 4: User Story 2 — Act on a parked tangent in one click (P1)

**Goal**: firing a parked item creates the branch in one transaction. It either sends the
question and streams the reply, or preloads the composer with the anchor text.

**Independent test**: QS 5–8.

### Tests for User Story 2

- [X] T021 [P] [US2] Integration tests in `tests/integration/f8-parked.test.ts`
  (`describe("US2 fire")`), which covers QS 5, 6, 7 and 8:
  - **With a question**: `POST /api/parked/{id}/fire?wait=1` returns 201
    `{ kind: "sent" }`. The child's `parentId` is the node. The marker is `kind: "selection"` with
    the parked offsets. The child's first user message `content` equals the question exactly, and
    `aiMessage.status` is `complete`. The parent's `NodeView.parked` no longer has the item, and
    `children` includes the child. The child's `inheritedContext` includes the anchored message
    (FR-013a).
  - **Without a question**: 201 `{ kind: "preload", draft: anchor.text }`. The child has 0
    messages.
  - **Second fire**: 409 `parked_consumed`.
  - **Concurrent fires**: `Promise.all([fire, fire])` on one item gives exactly one 201 and one
    409, and the parent has exactly one child.
  - **AI failure**: `setFakeMode({ mode: "fail" })`, then fire an item with a question. It returns
    201, the user message exists, and the reply ends `failed`.
  - **Rollback**: firing into a node with `reply_in_progress` isn't possible, because the child is
    new. Instead, fire an item whose anchor message was made unbranchable by setting `status` in
    the test DB directly. The response is 409 `message_not_branchable`, no node is created, and the
    item is still live.
- [X] T022 [P] [US2] E2E tests in `tests/e2e/f8-branch-queue.spec.ts` (`test.describe("US2")`),
  which covers QS 5 and 6:
  - Park with "How does this scale?". Click the item's "Ask in new branch". The URL changes, the
    first user message reads exactly the question, and an AI reply appears.
  - Go back: the Parked tab is empty and the Branches tab lists the branch.
  - Park without a question and click "Open as branch". The new node has no messages, and the
    composer holds the anchor text.

### Implementation for User Story 2

- [X] T023 [US2] Create `src/server/parked/fire.ts` with `fireParked(id)`, per data-model.md
  "State transitions" and R2:
  1. `assertId(id, "Parked item")`.
  2. In one `db.transaction()`, do the following in order:
     - `lockTangent`
     - `question = currentQuestion`
     - `validateAnchor(trx, t.node_id, anchorOf(t))`
     - `{ child, marker } = insertBranch(...)`
     - if `question`, `{ userMessage, pending } = insertUserTurn(trx, child.id, question)`
     - insert `{ tangent_id: id, kind: "fired", child_node_id: child.id }`
  3. After commit, if there is a `pending` reply, call `void generate(child.id, pending.id)`.
  4. Return `kind: "sent"` with `toMapNode(child, t.anchor_text, placeholderFor(t.anchor_text))`,
     `toMarker(marker)` and `toMessage` of both messages. Or return
     `{ kind: "preload", node, marker, draft: t.anchor_text }`.

  If a unique violation on `parked_events_terminal` is raised (23505), map it to
  `ConflictError("parked_consumed", …)`.
- [X] T024 [US2] Create `src/app/api/parked/[id]/fire/route.ts`. `POST` returns 201. With
  `?wait=1` and `kind === "sent"`, replace `aiMessage` with `await waitFor(aiMessage.id)`, as in
  the messages route.
- [X] T025 [P] [US2] Add `fireParked: (id) => request("POST", `/api/parked/${id}/fire`, FireParkedResponse)`
  to `src/lib/api.ts`.
- [X] T026 [US2] In `src/components/chat/BranchPanel.tsx`, add the main button to each parked
  item, named "Ask in new branch" when it has a question and "Open as branch" when it doesn't.
  - On click, disable the button, then call `api.fireParked(id)`.
  - For `preload`, call `useViewStore.getState().setDraft(res.node.id, res.draft)`.
  - Then call `router.push(`/n/${res.node.id}`)`.
  - On `ApiError` 409 `parked_consumed`, call `reload()` silently. On other errors, show the
    message inline and re-enable the button.

**Checkpoint**: park, then fire, works for both kinds, including with the AI failing.

---

## Phase 5: User Story 3 — Direct branches in the panel (P2)

**Goal**: the Branches tab lists the open node's direct children and navigates to them.

**Independent test**: QS 11 and 12.

### Tests for User Story 3

- [X] T027 [P] [US3] Integration test in `tests/integration/f8-parked.test.ts`
  (`describe("US3 children")`), which covers QS 11. Build a root with children A then B, and a
  grandchild under A. The root's `NodeView.children` ids equal `[B, A]` (newest first), with no
  grandchild. A's `children` is `[grandchild]`.
- [X] T028 [P] [US3] E2E test in `tests/e2e/f8-branch-queue.spec.ts` (`test.describe("US3")`),
  which covers QS 11, 12 and 16:
  - After two `branchOn` calls from the root, the Branches tab lists 2 rows.
  - Clicking one opens `/n/{id}`, and there both tabs show `branches-empty` and `parked-empty`.
  - Click "Hide branch panel" and reload: the panel stays collapsed.

### Implementation for User Story 3

- [X] T029 [US3] Fill the Branches tab in `src/components/chat/BranchPanel.tsx`
  (`data-testid="branches-tab"`):
  - Each `view.children` item is a `next/link` `Link` to `/n/{id}`, showing `summary.text`, the
    quoted `anchorText` in muted type, and "{messageCount} messages".
  - When the list is empty, show `data-testid="branches-empty"`: "No branches from this
    conversation yet. Select text and choose Branch."

**Checkpoint**: the panel is useful even with nothing parked.

---

## Phase 6: User Story 4 — Edit or discard a parked tangent (P3)

**Goal**: change or clear an item's question, or discard the item. Each change affects only that
item.

**Independent test**: QS 9.

### Tests for User Story 4

- [X] T030 [P] [US4] Integration tests in `tests/integration/f8-parked.test.ts`
  (`describe("US4 edit and discard")`), which covers QS 9:
  - **Edit**: `POST /api/parked/{id}/question` with `{ question: "New" }` returns the new text.
    With `{ question: "" }` it returns `null`. Firing afterwards returns `preload`.
  - **Add**: adding a question to a question-less item makes fire return `sent`.
  - **Discard**: `POST /api/parked/{id}/discard` returns 200, and the item leaves `parked`. Other
    items are unchanged, and no node was created. A later edit, discard or fire gives 409
    `parked_consumed`.
  - **Unchanged question**: setting the same question twice writes one event only.
  - **Append-only**: the discarded tangent row still exists (`selectFrom("parked_tangents")`), and
    a raw `UPDATE parked_tangents` or `DELETE FROM parked_tangent_events` throws.
- [X] T031 [P] [US4] E2E test in `tests/e2e/f8-branch-queue.spec.ts` (`test.describe("US4")`):
  - Park two items. Use "Edit question" on one, type "Reworded", press Enter: it shows "Reworded".
  - "Discard" the other: it disappears, and the first is unchanged.

### Implementation for User Story 4

- [X] T032 [US4] Add to `src/server/parked/park.ts`:
  - `setParkedQuestion(id, question)`: in a transaction, `lockTangent`, then
    `next = normalizeQuestion(question)`. If `next !== await currentQuestion(trx, id)`, insert
    `{ kind: "question_set", question: next }`. Return `{ parked }`.
  - `discardParked(id)`: in a transaction, `lockTangent`, then insert `{ kind: "discarded" }`.
    Return `{ discarded: { id } }`.

  Map a 23505 on `parked_events_terminal` to `parked_consumed`, as in T023. Consider sharing that
  mapping from `state.ts`.
- [X] T033 [P] [US4] Add to `src/lib/api.ts`:
  - `setParkedQuestion: (id, question) => request("POST", `/api/parked/${id}/question`, ParkedResponse, { question })`
  - `discardParked: (id) => request("POST", `/api/parked/${id}/discard`, DiscardParkedResponse)`
- [X] T034 [US4] Create `src/app/api/parked/[id]/question/route.ts`: `POST`,
  `readJson(req, ParkedQuestionRequest)`, returns 200.
- [X] T035 [US4] Create `src/app/api/parked/[id]/discard/route.ts`: `POST`, returns 200.
- [X] T036 [US4] In `src/components/chat/BranchPanel.tsx`, add two actions to each parked item:
  - **"Edit question"**: swaps the question line for an input prefilled with the current question.
    Enter calls `api.setParkedQuestion` and then `reload()`. Escape cancels. Saving an empty value
    clears the question.
  - **"Discard"**: hides the item immediately, calls `api.discardParked`, then `reload()`. On
    failure, it restores the item and shows the error. There is no confirmation dialog.
  - On 409 `parked_consumed`, call `reload()` silently.

**Checkpoint**: every story works on its own and together.

---

## Phase 7: Polish & Cross-Cutting

- [X] T037 Add a `Feature 8` case to `tests/integration/constitution.test.ts`, per data-model.md
  "Constitution guards":
  1. After parking, editing, discarding and firing through `call()`, every `parked_tangents` and
     `parked_tangent_events` row has `provenance === "user_authored"`.
  2. No file in `src` matches `/(updateTable|deleteFrom)\("parked_(tangents|tangent_events)"\)/`.
  3. Every file in `src` that mentions `parked_tangents` or `parked_tangent_events` is under
     `src/server/parked/` or `src/server/db/`, or is `src/server/forest/nodeView.ts` or
     `src/server/messages/regenerate.ts`. Make `nodeView.ts` and `regenerate.ts` go through
     `state.ts` helpers, so ideally only `parked/` and `db/` match.
  4. No file under `src/server/ai`, `src/server/summaries`, `src/server/suggestions`,
     `src/server/messages/replyInput.ts` or `src/server/forest/forest.ts` matches `/parked/i`.
- [X] T038 [P] E2E regression in `tests/e2e/f8-branch-queue.spec.ts`, which covers QS 15: after
  parking an item, typing `????` still quick-branches from the last user message, and the parked
  item is still listed in the parent.
- [X] T039 Check the panel at 1400px, 1000px and 600px widths. The chat narrows beside it, it
  overlays only below 640px, the feedback drawer opens above it, and the toolbar form doesn't jump when the
  input is focused. Fix any issues in `src/app/globals.css`.
- [X] T040 Run `npm run typecheck`, `npm run lint`, `npm test` and `npm run test:e2e`. Fix any
  failures, then walk through every row of quickstart.md.

---

## Dependencies & Execution Order

- **Setup (T001–T003)** → **Foundational (T004–T012)** → user stories.
- **US1 (Phase 3)** is the MVP. US2 needs parked items to exist, so it runs after US1 (T015 and
  T019).
- **US3 (Phase 5)** depends only on Foundational, and can run in parallel with US1 and US2.
- **US4 (Phase 6)** needs US1's park and Parked tab (T015 and T019). It doesn't need US2.
- **Polish** runs after all the stories.

Within Foundational:

- T004, T005, T006 and T010 are independent `[P]`.
- T007 needs T002.
- T008 needs T004.
- T009 needs T007 and T008.
- T011 needs T009 and T010.

Within stories, the tests come first; then services, then routes, then the client API, then UI.

### Shared-file notes

- **`BranchPanel.tsx`** is touched by T011, T019, T026, T029 and T036. **`src/lib/api.ts`** is
  touched by T017, T025 and T033.
- Those tasks are `[P]` only relative to other files. Serialize the edits to the same file.

## Parallel examples

```text
Foundational:  T004 ∥ T005 ∥ T006 ∥ T010, then T007 → T008 → T009 → T011
US1:           T013 ∥ T014 ∥ T017, then T015 → T016 → T018 → T019 → T020
US2:           T021 ∥ T022 ∥ T025, then T023 → T024 → T026
US3 (with US1/US2): T027 ∥ T028, then T029
US4:           T030 ∥ T031 ∥ T033, then T032 → T034 ∥ T035 → T036
```

## Implementation Strategy

1. **MVP**: Setup, Foundational and US1. Tangents can be parked and seen, and Branch preloads its
   composer. Stop and validate QS 1–4, 10, 13 and 14.
2. **US2**: parked items become one-click branches. This completes the P1 value.
3. **US3**: the Branches tab. It is independent and can be built alongside steps 1 and 2.
4. **US4**: edit and discard.
5. **Polish**: constitution guards, regression, the layout check, the full test run, and the
   quickstart walk-through.
