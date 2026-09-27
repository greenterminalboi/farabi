---
description: "Task list for Map Interactions, Definitions, and Streaming"
---

# Tasks: Map Interactions, Definitions, and Streaming

**Input**: Design documents from `/specs/002-map-definitions-streaming/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/http-api.md,
contracts/ai-provider.md, quickstart.md; Feature 1 code on `main`

**Tests**: Included, as in Feature 1: quickstart.md asks for a Playwright test per scenario, and
the streaming, quick-branch and layout rules need automated checks. Feature 2 test files are
prefixed `f2-` so they sit beside Feature 1's.

**Organization**: Tasks are grouped by user story (US1–US5 from spec.md).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to
- Paths are relative to the repository root

## Conventions for every task

- Follow Feature 1's conventions (`specs/001-branching-chat-map/tasks.md`): domain logic in
  `src/server/` without `next/*` imports; thin route handlers wrapped in `withApi`; shared Zod
  schemas in `src/shared/schemas.ts`; typed client in `src/lib/api.ts`.
- Never add DELETE or PATCH handlers. Never write `nodes.parent_id` after a node is created.
- A message's `content` is written exactly once, when its reply ends.

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Create migration `src/server/db/migrations/0002_workspace.ts` per data-model.md: `ALTER TYPE message_status ADD VALUE 'incomplete'` and `'stopped'`; `CREATE TYPE marker_kind AS ENUM ('selection', 'whole_message')`; `trees.user_placed boolean NOT NULL DEFAULT false`; `nodes.manual_x real NULL`, `nodes.manual_y real NULL` with `CHECK ((manual_x IS NULL) = (manual_y IS NULL))`; `messages.partial_content text NULL`; `branch_markers.kind marker_kind NOT NULL DEFAULT 'selection'` plus `CREATE UNIQUE INDEX ... ON branch_markers (message_id) WHERE kind = 'whole_message'`; tables `edge_label_versions` (id, `child_node_id` FK nodes, `text` nullable "trimmed, ≤ 200 characters", `provenance`, created_at), `definitions` (id, `term` "≤ 120 characters", `term_key` unique, `source_node_id` FK nodes, `source_message_id` FK messages, `draft_failed_at` nullable, created_at), `definition_versions` (id, `definition_id` FK definitions, `general_text`, `usage_text`, `provenance`, created_at); all FKs `ON DELETE RESTRICT`; indexes on `edge_label_versions (child_node_id, created_at DESC)` and `definition_versions (definition_id, created_at DESC)`
- [X] T002 Update Kysely types in `src/server/db/schema.ts` for T001 (new enum values, `MarkerKind`, new columns, three new tables) and run `npm run db:migrate` and `npx tsx scripts/migrate.ts --test`

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Extend shared shapes in `src/shared/schemas.ts` per contracts/http-api.md "Shared shape changes": `Message.status` adds `"incomplete" | "stopped"`, `Message.partialContent`; `Marker.kind`; `MapNode.manual` and `MapNode.edgeLabel`; `MapTree.userPlaced`; new `DefinitionVersion` and `Definition`; `SendMessageResponse` becomes a discriminated union on `kind` (`"message" | "quick_branch"`)
- [X] T004 Update mappers in `src/server/mappers.ts` for T003 (`partial_content`, `kind`, `manual_x/manual_y` → `manual`, `user_placed` → `userPlaced`); pass `edgeLabel: null` until US5 fills it
- [X] T005 [P] Update the integration helper `tests/integration/helpers.ts` with routes for every new endpoint in contracts/http-api.md, and add `sendAndWait(nodeId, content)` that posts to `/api/nodes/{id}/messages?wait=1`

**Checkpoint**: `npm run typecheck && npm test` pass with Feature 1 behaviour unchanged

---

## Phase 3: User Story 1 — Watch a reply arrive (Priority: P1) 🎯 MVP

**Goal**: Replies stream in, survive navigation, can be stopped, and keep partial text when cut off

**Independent Test**: A long reply shows text before it finishes; Stop keeps text marked
"stopped"; a stalled reply keeps text marked "incomplete" across reloads; Retry makes a new attempt

### Tests for User Story 1

- [X] T006 [P] [US1] Integration tests in `tests/integration/f2-us1-streaming.test.ts`: `POST .../messages` returns 201 with `aiMessage.status = "pending"` before the reply ends; `?wait=1` returns the completed reply; the SSE route sends `snapshot`, then `delta` events whose concatenation equals the final content, then `end`; `POST /api/messages/{id}/stop` ends it `stopped` with the text so far as `content`; fake `stall` mode ends it `incomplete` with the partial text; a `pending` row with no live generator and a `partial_content` checkpoint is finalised as `incomplete` on read; retry works on `incomplete` and `stopped` and marks the old row replaced; a summary is written only after a `complete` reply
- [X] T007 [P] [US1] Playwright test `tests/e2e/f2-us1-streaming.spec.ts` for quickstart scenario 1: the first chunk is visible before the last arrives; Stop → "stopped" label + Retry; `stall` → "incomplete" label that survives reload; switch to the map mid-reply and back → the completed reply is shown

### Implementation for User Story 1

- [X] T008 [US1] Extend the AI boundary in `src/server/ai/provider.ts` per contracts/ai-provider.md: `ReplyOptions { onText? }`, `reply(input, options?)`, and `class AIPartialReplyError extends AIUnavailableError` carrying `partial`
- [X] T009 [P] [US1] Fake provider streaming in `src/server/ai/fake.ts`: `reply` delivers its text through `onText` in 5 chunks 40 ms apart and honours `input.signal` (reject with an `AbortError` when aborted); new mode `stall` delivers 2 chunks then rejects with `AIPartialReplyError`; accept `"stall"` in `src/app/api/test/ai-mode/route.ts`
- [X] T010 [P] [US1] Claude API streaming in `src/server/ai/claude.ts`: attach `stream.on("text", delta => options?.onText?.(delta))`; on failure after any text, throw `AIPartialReplyError(textSoFar)`
- [X] T011 [P] [US1] Claude Code streaming in `src/server/ai/claudeCode.ts`: use `--output-format stream-json --verbose --include-partial-messages`; read stdout line by line; forward `stream_event` → `content_block_delta` with `delta.type === "text_delta"` to `onText`; resolve from the final `result` event (`subtype === "success"`), otherwise reject with `AIPartialReplyError` if text was delivered, else `AIUnavailableError`; kill the process on abort (verified event shapes in research R3)
- [X] T012 [US1] Create the generation registry `src/server/messages/generation.ts` (state on `globalThis`): `startGeneration(nodeId, messageId, inputBuilder)` runs `provider.reply` with `onText` appending to an in-memory buffer and notifying subscribers; checkpoints the buffer to `messages.partial_content` at most once per second; on success writes `content`, `status 'complete'`, clears `partial_content`, calls `summaryAfterReply`; on `AIPartialReplyError` writes the partial text with `status 'incomplete'`; on abort writes the buffer with `status 'stopped'`; on `AIUnavailableError` before any text sets `status 'failed'`; exports `subscribe(messageId, listener)`, `stopGeneration(messageId)`, `waitFor(messageId)`, and `finalizeOrphan(message)` (a `pending` row with no live generator becomes `incomplete` with `content = partial_content ?? ''`)
- [X] T013 [US1] Refactor `src/server/messages/send.ts`: `sendMessage` stores the user message and a `pending` AI message (as now), starts `startGeneration`, and returns `{ kind: "message", userMessage, aiMessage }` immediately; `completeReply` is replaced by the registry; keep the `reply_in_progress` 409
- [X] T014 [US1] Update `src/server/messages/retry.ts` to accept AI messages in `failed`, `incomplete` or `stopped` status (latest live message only), mark the old row replaced, insert a new `pending` row with the same `seq`, and start generation
- [X] T015 [US1] Update `src/server/messages/regenerate.ts` to stream: in one transaction mark the old reply replaced and insert a new `pending` row with the same `seq`, then start generation (the replaced reply is kept, per Feature 1 FR-030; a failed regeneration leaves a failed/incomplete reply that can be retried)
- [X] T016 [US1] Finalise orphans on read: in `src/server/forest/nodeView.ts` call `finalizeOrphan` for any `pending` message without a live generator before building the view; include `partialContent` in returned messages
- [X] T017 [US1] Routes: `src/app/api/messages/[messageId]/stream/route.ts` (GET, `text/event-stream`, events per contracts/http-api.md, `export const dynamic = "force-dynamic"`, closes when the client disconnects without stopping generation); `src/app/api/messages/[messageId]/stop/route.ts` (POST → 200 `{ message }`, 409 `not_streaming`); `?wait=1` support in `src/app/api/nodes/[nodeId]/messages/route.ts`, `.../retry/route.ts` and `.../regenerate/route.ts` via `waitFor`
- [X] T018 [US1] Update Feature 1 tests for asynchronous sending: use `sendAndWait` (or `?wait=1`) in `tests/integration/us1-conversations.test.ts`, `us2-branching.test.ts`, `us3-forest.test.ts`, `us5-summaries.test.ts`, `constitution.test.ts`; adjust `tests/e2e/helpers.ts` `send()` to wait for the reply's `end` (no pending indicator) instead of a fixed count
- [X] T019 [P] [US1] Client stream hook `src/lib/replyStream.ts`: `useReplyStream(messageId | null)` opens an `EventSource` on `/api/messages/{id}/stream`, returns `{ text, final: Message | null }`, closes on `end` or unmount
- [X] T020 [US1] Chat UI in `src/components/chat/ChatView.tsx` and `src/components/chat/Message.tsx`: remove the optimistic placeholders; after send, reload the view and attach `useReplyStream` to any `pending` AI message; render streaming text with a caret; show "Stopped" or "Incomplete — connection lost" labels with Retry for those statuses; show a Stop button (in `src/components/chat/Composer.tsx`, replacing Send while a reply streams) that calls `api.stop`; add `stop` and updated response types to `src/lib/api.ts`

**Checkpoint**: Replies stream; Feature 1 suites pass with the async send

---

## Phase 4: User Story 2 — Branch without highlighting using "????" (Priority: P1)

**Goal**: An exact `????` branches from the user's last message and resends it in the new branch

**Independent Test**: Message, then `????` → new branch with that message first and a reply
streaming; parent shows a whole-message marker; the AI never receives `????`

### Tests for User Story 2

- [X] T021 [P] [US2] Integration tests in `tests/integration/f2-us2-quick-branch.test.ts`: `????` after a user message returns `kind: "quick_branch"` with a child of the current node and a `whole_message` marker spanning `0..content.length` of that user message; the child's first message equals the anchored text and gets a reply; the fake provider's recorded inputs never contain `????`; no `????` row exists in the parent; the child's inherited context stops before the anchored message; works when the anchored message already has a reply; `????` with no user message, a second `????` on the same anchor, `" ???? "` padding (branches), and `"does this mean ????"` (ordinary) follow FR-006–FR-013
- [X] T022 [P] [US2] Playwright test `tests/e2e/f2-us2-quick-branch.spec.ts` for quickstart scenario 2

### Implementation for User Story 2

- [X] T023 [US2] Create `src/server/messages/quickBranch.ts`: `tryQuickBranch(nodeId)` finds the node's latest live `complete` user message; returns null if none or if a `whole_message` marker already exists on it; otherwise in one transaction creates the child node (`user_authored`) and a `branch_markers` row with `kind 'whole_message'`, `start_offset 0`, `end_offset length(content)`, `anchor_text = content`, empty prefix/suffix; then calls `sendMessage(child.id, content)` and returns `{ kind: "quick_branch", node, marker, userMessage, aiMessage }`
- [X] T024 [US2] In `src/server/messages/send.ts`, before storing anything: if `content.trim() === "????"`, call `tryQuickBranch`; return its result when non-null, otherwise continue as an ordinary message (FR-012, FR-013)
- [X] T025 [US2] In `src/server/forest/inheritedContext.ts`, for an ancestor whose next branch point is a `whole_message` marker, include messages with `seq < cut_seq` instead of `seq <= cut_seq` (FR-011)
- [X] T026 [US2] Client: in `src/components/chat/ChatView.tsx`, when the send response has `kind: "quick_branch"`, clear the draft and navigate to `/n/{node.id}`; confirm `src/components/chat/Message.tsx` draws a whole-message marker over the full user message (it is an ordinary `0..length` range)

**Checkpoint**: Both P1 stories work; this is the MVP

---

## Phase 5: User Story 3 — Rearrange the map by hand (Priority: P2)

**Goal**: Drag trees (by their root) and individual nodes; positions persist; structure never changes

**Independent Test**: Drag a root and a non-root node; reload; positions kept; every line joins the
same nodes; a click still opens a conversation

### Tests for User Story 3

- [X] T027 [P] [US3] Unit tests in `tests/unit/f2-layout-manual.test.ts`: `layoutTree` replaces positions of nodes with `manual` and keeps tidy positions for others; the tree box includes hand-placed nodes; adding a child to a tree keeps hand-placed positions; `layoutForest` never relocates a `userPlaced` tree and relocates an auto-placed tree away from a `userPlaced` one
- [X] T028 [P] [US3] Integration tests in `tests/integration/f2-us3-positions.test.ts`: `PUT /api/nodes/{id}/position` stores relative `manual` (finite numbers, 422 otherwise) and returns 409 `root_node` for roots; `PUT /api/trees/{id}/origin` with `byUser: true` sets `userPlaced`; no position endpoint changes any `parent_id`
- [X] T029 [P] [US3] Playwright test `tests/e2e/f2-us3-drag.spec.ts` for quickstart scenario 3, dragging with `page.mouse` between points from `window.__farabiMapScreenPoint`; asserts positions from `window.__farabiMapDebug` before and after reload

### Implementation for User Story 3

- [X] T030 [P] [US3] Create `src/server/forest/positions.ts`: `setNodePosition(nodeId, x, y)` (409 `root_node` if `parent_id IS NULL`; writes `manual_x/manual_y`) and route `src/app/api/nodes/[nodeId]/position/route.ts` (PUT, body `{ x, y }` finite)
- [X] T031 [US3] Extend `setTreeOrigin` in `src/server/forest/trees.ts` and `src/app/api/trees/[treeId]/origin/route.ts` with optional `byUser` that also sets `user_placed = true`; include `manual_x/manual_y` and `user_placed` in `src/server/forest/forest.ts`
- [X] T032 [US3] Layout: in `src/map/forestGraph.ts` carry `manual` as a node attribute; in `src/map/layout/treeLayout.ts` apply `manual` overrides after the tidy layout and compute the box from final positions; in `src/map/layout/forestLayout.ts` skip relocation for `userPlaced` trees and treat them as fixed obstacles
- [X] T033 [US3] Dragging in `src/map/MapRenderer.ts`: on node `pointerdown` record the start; after 4 px of movement pause the viewport drag (`viewport.plugins.pause("drag")`) and move the node (non-root) or the whole tree (root) with the pointer in world coordinates, redrawing only edges touching it; on `pointerup` resume the viewport and call `onNodeMoved(id, relX, relY)` or `onTreeMoved(treeId, x, y)`; under 4 px keep the existing click behaviour (FR-022); keep `__farabiMapDebug` positions current
- [X] T034 [US3] Persist drags in `src/components/map/MapHost.tsx`: on `onNodeMoved` call `api.setNodePosition`, on `onTreeMoved` call `api.setTreeOrigin(id, x, y, true)`; update `forestRef` so polling doesn't snap nodes back; add both calls to `src/lib/api.ts`

---

## Phase 6: User Story 4 — Build a glossary while reading (Priority: P2)

**Goal**: Capture terms, get short two-part AI drafts, confirm or edit them, and see every
occurrence underlined with a hover card

**Independent Test**: Capture a term → draft appears in the Definitions tab with a source link;
capture it again elsewhere → no duplicate; hover any occurrence → card; confirm/edit → confirmed

### Tests for User Story 4

- [X] T035 [P] [US4] Unit tests in `tests/unit/f2-terms.test.ts` for `src/lib/terms.ts`: term keys (case, trimming, inner spaces); whole-word matching ("pod" not in "podcast"); longest match first ("control plane" over "plane"); matches keep correct raw offsets when splitting offset spans; and for `parseDefinition` in `src/server/ai/claudePrompts.ts`
- [X] T036 [P] [US4] Integration tests in `tests/integration/f2-us4-definitions.test.ts`: capture returns 201 `created: true` then an `ai_suggested` version appears (with both parts); capturing the same term (different case/spacing, other conversation) returns 200 `created: false` with the same id and keeps the first source; confirm adds a `user_confirmed` copy; an edit adds a `user_confirmed` version and keeps the draft in history; a failed draft sets `draft_failed_at` and `redraft` recovers; capture from a non-complete message is refused; the fake `define` input holds only the source node's own messages
- [X] T037 [P] [US4] Playwright test `tests/e2e/f2-us4-definitions.spec.ts` for quickstart scenario 4, including the hover card over a term in a different conversation

### Implementation for User Story 4

- [X] T038 [US4] Provider `define()` per contracts/ai-provider.md: interface in `src/server/ai/provider.ts`; fake in `src/server/ai/fake.ts`; prompt + `parseDefinition` (expects `GENERAL:` ≤ 2 sentences and `IN THIS CONVERSATION:` 1 sentence) in `src/server/ai/claudePrompts.ts`; `define` in `src/server/ai/claude.ts` (effort low) and `src/server/ai/claudeCode.ts` (`--effort low`)
- [X] T039 [US4] Create `src/server/definitions/`: `termKey.ts` (lower-case, trim, collapse whitespace); `capture.ts` (validate the selection like `createBranch`: complete message of the node, exact substring, non-empty, ≤ 120 characters; insert or return the existing row by `term_key`; enqueue drafting when created); `draftQueue.ts` (background, max 2 concurrent, calls `define` with the term, source message and the source node's own complete messages, inserts an `ai_suggested` version or sets `draft_failed_at`); `versions.ts` (`confirm`, `saveEdit` with trimmed non-empty parts, `redraft`); `list.ts` (list newest first with status `drafting | failed | draft | confirmed`, index view, get with versions)
- [X] T040 [US4] Routes per contracts/http-api.md: `src/app/api/definitions/route.ts` (POST capture, GET list / `?index=1`), `src/app/api/definitions/[id]/route.ts` (GET), `.../confirm/route.ts`, `.../versions/route.ts`, `.../redraft/route.ts`; add them to `src/lib/api.ts`
- [X] T041 [P] [US4] Create `src/lib/terms.ts`: `termKey`, `buildMatcher(terms)` (escaped terms, longest first, `(?<![\p{L}\p{N}])(…)(?![\p{L}\p{N}])` with flags `giu`), and `splitByTerms(text, start, matcher)` returning segments with raw offsets and matched definition ids; plus a Zustand store `src/state/definitionsStore.ts` holding the index and a cache of full entries, refreshed after captures and edits
- [X] T042 [US4] Mark terms in text: extend `src/components/chat/rehypeSourceOffsets.ts` and the plain-text renderer in `src/components/chat/Message.tsx` to split spans at term matches (class `term-mark`, `data-def-id`) while keeping `data-start/data-end` exact; apply the same marking in `src/components/chat/InheritedContext.tsx`
- [X] T043 [US4] Hover card `src/components/definitions/TermCard.tsx`: shown on `pointerover`/`focusin` of `.term-mark` (one instance in `ChatView`), with term, general part, usage part, draft/confirmed state ("Being drafted…" while drafting) and a link to `/definitions#<id>`
- [X] T044 [US4] "Send to definitions" beside Branch in `src/components/chat/BranchAction.tsx`: posts the current selection to `api.captureDefinition`; on `created: false` show "Already in Definitions" with a link to the entry
- [X] T045 [US4] Definitions tab: `src/app/definitions/page.tsx` + `src/components/definitions/DefinitionsList.tsx` (newest first, filter box, each card with term, both parts, state badge, source link to `/n/{nodeId}`, Confirm on drafts, Edit form saving both parts, "Couldn't draft" + Retry, and a collapsed version history); add a "Definitions" link to `src/components/common/ViewToggle.tsx`

---

## Phase 7: User Story 5 — Label a relationship on the map (Priority: P3)

**Goal**: Attach, edit and clear free-text labels on parent–child lines

**Independent Test**: Click a line, label it, reload → label drawn; edit; clear

### Tests for User Story 5

- [X] T046 [P] [US5] Integration tests in `tests/integration/f2-us5-edge-labels.test.ts`: `PUT /api/nodes/{id}/edge-label` stores a `user_authored` version and `GET /api/forest` returns it as `edgeLabel`; blank or null clears it (new version with NULL text, forest shows null); text is trimmed and > 200 characters is 422; roots return 409 `root_node`
- [X] T047 [P] [US5] Playwright test `tests/e2e/f2-us5-edge-labels.spec.ts` for quickstart scenario 5, clicking a line at a point from a new `window.__farabiMapEdgePoint(childId)` hook

### Implementation for User Story 5

- [X] T048 [P] [US5] Create `src/server/forest/edgeLabels.ts` (`setEdgeLabel(childNodeId, text | null)` inserting into `edge_label_versions`) and route `src/app/api/nodes/[nodeId]/edge-label/route.ts`; return the latest label per node from `src/server/forest/forest.ts`
- [X] T049 [US5] In `src/map/MapRenderer.ts`: draw each non-null `edgeLabel` as `BitmapText` at its edge midpoint, hidden below zoom 0.5 and shortened to 40 characters; on a background click, select the nearest edge within 8 screen pixels (sampled along each bezier) and call `onEdgeClick(childId, screenPoint)`; expose `window.__farabiMapEdgePoint` in test builds
- [X] T050 [US5] Create `src/components/map/EdgeLabelEditor.tsx`, an HTML input positioned over the canvas at the clicked point, prefilled with the current label; Enter saves via `api.setEdgeLabel`, Escape cancels, an empty value clears; wire it in `src/components/map/MapHost.tsx`

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T051 [P] Extend `tests/integration/constitution.test.ts`: no route or server module writes `parent_id` in an update; every `definition_versions` row is `ai_suggested` or `user_confirmed` and every `edge_label_versions` row `user_authored`; no DELETE on the new tables
- [X] T052 [P] Extend `scripts/seed-large.ts` with 500 definitions (one version each) and a few edge labels; extend `tests/e2e/scale.spec.ts` with SC-009/SC-009a checks (Definitions tab < 1 s, conversation with marked terms < 1 s, hover card < 300 ms) and a drag at 500 nodes
- [X] T053 [P] Update `README.md` (streaming, `????`, dragging, Definitions, edge labels) and `specs/001-branching-chat-map/contracts/http-api.md` with a pointer to Feature 2's changes
- [X] T054 Run `npm run lint && npm run typecheck && npm test && npm run test:e2e` and every quickstart scenario, including one manual pass of scenarios 1–2 with `AI_PROVIDER=claude-code`; fix failures

---

## Dependencies & Execution Order

- **Setup → Foundational** block everything.
- **US1 (streaming)** first: it changes how every reply is produced, which US2 relies on.
- **US2** after US1 (its branch's first reply streams).
- **US3, US4, US5** only need Foundational and can run in parallel with each other (and with US1/US2),
  except that T049 and T033 both edit `src/map/MapRenderer.ts`, so do US3 before US5 or merge carefully.
- **Polish** last.

```text
Setup → Foundational → US1 → US2
                    ├→ US3 → US5
                    └→ US4
```

## Implementation notes (2026-09-27)

- Fixed two root causes of Feature 1's flaky map-click tests: the test hook now renders before
  returning screen points, and the viewport has a fixed hit area (its default one went stale after
  programmatic moves, so nodes outside the previous view couldn't be clicked).
- A regenerated reply now streams: the old reply is marked replaced when regeneration starts (still
  kept, Feature 1 FR-030); a failed regeneration leaves a retryable reply instead of restoring it.
- SC-006 drag check measures frame pacing in the page during a real drag (17 ms frames at 500
  nodes); measuring through Playwright round trips was not meaningful.
- Live check with the Claude Code provider: first streamed text ~2 s, full reply ~5.5 s.

## Parallel Opportunities

- US1: T006, T007, T009, T010, T011, T019
- US2: T021, T022
- US3: T027, T028, T029, T030
- US4: T035, T036, T037, T041
- US5: T046, T047, T048
- Polish: T051, T052, T053

## Parallel Example: User Story 4

```bash
Task: "Unit tests for terms and parseDefinition in tests/unit/f2-terms.test.ts"
Task: "Integration tests for definitions in tests/integration/f2-us4-definitions.test.ts"
Task: "Term matcher and store in src/lib/terms.ts and src/state/definitionsStore.ts"
```

## Implementation Strategy

1. Setup + Foundational.
2. **MVP**: US1 streaming, then US2 quick branch — the conversation-side improvements.
3. US3 dragging, US4 definitions (largest), US5 edge labels.
4. Polish: guards, scale, docs, full run.
