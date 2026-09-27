---
description: "Task list for Branching Chat with Map View"
---

# Tasks: Branching Chat with Map View

**Input**: Design documents from `/specs/001-branching-chat-map/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/http-api.md,
contracts/ai-provider.md, quickstart.md

**Tests**: Included. quickstart.md requires each validation scenario to exist as a Playwright
test, and the layout, selection and constitution invariants need automated checks. Tests are
kept to one integration file and one e2e file per story, plus unit tests for layout and
selection logic.

**Organization**: Tasks are grouped by user story (US1–US5 from spec.md).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to
- Paths are relative to the repository root (single Next.js project, see plan.md)

## Conventions for every task

- TypeScript `strict`. Domain logic lives in `src/server/` and MUST NOT import from `next/*`.
- Route handlers in `src/app/api/**/route.ts` are thin: parse input with the shared Zod schema,
  call one `src/server/` function, return JSON through the `withApi` wrapper (T013).
- Never add DELETE or PATCH handlers for trees, nodes, markers or messages (FR-009, FR-028).
- All AI calls go through `getAIProvider()` (T016). Development and tests use the fake provider.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and tooling

- [X] T001 Initialize a Next.js (App Router, `src/` directory, TypeScript) project at the repository root with pnpm: `package.json`, `tsconfig.json` (`"strict": true`, path alias `@/*` → `src/*`), `next.config.ts`
- [X] T002 Add dependencies to `package.json`: `react`, `react-dom`, `next`, `pixi.js@^8`, `pixi-viewport`, `graphology`, `graphology-types`, `d3-hierarchy`, `zustand`, `zod`, `kysely`, `pg`, `react-markdown`; dev: `typescript`, `@types/pg`, `@types/d3-hierarchy`, `vitest`, `@playwright/test`, `tsx`, `eslint`, `eslint-config-next`, `prettier`
- [X] T003 [P] Create `docker-compose.yml` with service `db` using image `pgvector/pgvector:pg17`, port `5432:5432`, env `POSTGRES_USER=farabi`, `POSTGRES_PASSWORD=farabi`, `POSTGRES_DB=farabi`, named volume `farabi-pgdata`, and mount `db/init/` to `/docker-entrypoint-initdb.d/`; create `db/init/01-create-test-db.sql` containing `CREATE DATABASE farabi_test;`
- [X] T004 [P] Create `.env.example` with `DATABASE_URL=postgres://farabi:farabi@127.0.0.1:5432/farabi`, `TEST_DATABASE_URL=postgres://farabi:farabi@127.0.0.1:5432/farabi_test`, `AI_PROVIDER=fake`; create `.gitignore` covering `node_modules`, `.next`, `.env.local`, `test-results`, `playwright-report`
- [X] T005 [P] Configure ESLint (`eslint.config.mjs`, extends `next/core-web-vitals` and `next/typescript`) and Prettier (`.prettierrc`, `printWidth: 100`)
- [X] T006 [P] Create `vitest.config.ts` with two projects: `unit` (`tests/unit/**/*.test.ts`, environment `node`) and `integration` (`tests/integration/**/*.test.ts`, `setupFiles: tests/integration/setup.ts`, `fileParallelism: false`); create `playwright.config.ts` with `testDir: tests/e2e`, `webServer: { command: "pnpm dev", url: "http://127.0.0.1:3000", env: { DATABASE_URL: <TEST_DATABASE_URL>, AI_PROVIDER: "fake" } }`, single worker
- [X] T007 Add scripts to `package.json`: `dev` (`next dev -H 127.0.0.1`), `build`, `start` (`next start -H 127.0.0.1`), `lint`, `test` (`vitest run`), `test:e2e` (`playwright test`), `db:migrate` (`tsx scripts/migrate.ts`), `seed:large` (`tsx scripts/seed-large.ts`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database, shared contracts, API plumbing and AI boundary used by every story

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T008 Create the database client in `src/server/db/client.ts`: a Kysely instance over a `pg` `Pool` using `process.env.DATABASE_URL`, cached on `globalThis` so Next.js hot reload does not open new pools; export `db` and `type DB`
- [X] T009 Create migration `src/server/db/migrations/0001_initial.ts` implementing data-model.md exactly: `CREATE EXTENSION IF NOT EXISTS vector`; enums `provenance` (`'ai_suggested' | 'user_confirmed' | 'user_authored'`), `message_role` (`'user' | 'ai'`), `message_status` (`'pending' | 'complete' | 'failed'`); tables `trees`, `nodes`, `branch_markers`, `messages`, `node_summaries` with every column listed there, `created_at timestamptz NOT NULL DEFAULT now()`, UUID PKs `DEFAULT gen_random_uuid()`, all FKs `ON DELETE RESTRICT`; constraints: `trees.root_node_id` "unique, deferrable" (`DEFERRABLE INITIALLY DEFERRED`); `branch_markers.child_node_id` unique; `CHECK (end_offset > start_offset AND start_offset >= 0)`; messages `UNIQUE (node_id, seq) WHERE replaced_at IS NULL` (partial unique index); indexes on `nodes(tree_id)`, `nodes(parent_id)`, `messages(node_id, seq)`, `branch_markers(parent_node_id)`, `node_summaries(node_id, created_at DESC)`
- [X] T010 Create `scripts/migrate.ts` that runs Kysely's `Migrator` with `FileMigrationProvider` over `src/server/db/migrations/` against `DATABASE_URL` (or `TEST_DATABASE_URL` when `--test` is passed) and exits non-zero on failure
- [X] T011 [P] Define Kysely table types in `src/server/db/schema.ts` matching T009 (`Generated<>` for ids and `created_at`; nullable columns as `| null`)
- [X] T012 [P] Define shared Zod schemas and inferred types in `src/shared/schemas.ts` for every shape in contracts/http-api.md "Shared shapes" (`Provenance`, `Summary`, `Anchor`, `MapNode`, `MapTree`, `Message`, `Marker`) plus request/response schemas for each endpoint
- [X] T013 [P] Create domain error classes in `src/server/errors.ts` (`NotFoundError`, `ConflictError(code)`, `InvalidSelectionError`, `AIServiceUnavailable`) and the `withApi(handler)` wrapper in `src/server/http/withApi.ts`: rejects with `403` when `Host` is not `localhost`/`127.0.0.1` (any port) or `Origin` is present and differs from the request's own origin; maps Zod failures → `422 invalid_request`, `NotFoundError` → `404`, `ConflictError` → `409 <code>`, `InvalidSelectionError` → `422 invalid_selection`, `AIServiceUnavailable` → `503 ai_unavailable`; body shape `{ error: { code, message } }`
- [X] T014 [P] Create the AI boundary in `src/server/ai/provider.ts` exactly as contracts/ai-provider.md: `ChatTurn`, `ReplyInput`, `SummaryInput`, `AIProvider`, `AIUnavailableError`
- [X] T015 [P] Implement `FakeAIProvider` in `src/server/ai/fake.ts` per contracts/ai-provider.md: `reply` returns `"Echo: <last user message>. Containers are mentioned here."`; `summarize` returns `"About: <last 6 words of the last message>."`; module-level `setFakeMode({ mode: "ok" | "fail" | "slow", delayMs?: number })`; records the last `ReplyInput` and `SummaryInput` in `getFakeCalls()` for tests
- [X] T016 Create `getAIProvider()` in `src/server/ai/index.ts`: returns the `FakeAIProvider` when `AI_PROVIDER` is `fake` or unset; throws `"AI provider not configured (research R10)"` for anything else
- [X] T017 [P] Create the test-only route `src/app/api/test/ai-mode/route.ts` (`POST { mode, delayMs? }` → `setFakeMode`) that returns `404` unless `NODE_ENV !== "production"` and `AI_PROVIDER` is `fake`
- [X] T018 [P] Create a typed client in `src/lib/api.ts`: one function per endpoint in contracts/http-api.md, parsing responses with the schemas from T012 and throwing an `ApiError { status, code }` on non-2xx
- [X] T019 [P] Create the Zustand store in `src/state/viewStore.ts`: `byNode: Record<nodeId, { scrollTop: number; draft: string }>`, `lastNodeId: string | null`, actions `setScroll`, `setDraft`, `setLastNode` (in memory only, research R7)
- [X] T020 Create the app shell in `src/app/layout.tsx` with a top bar containing `src/components/common/NewConversationButton.tsx` (POST `/api/trees`, then navigate to `/n/{rootNodeId}`) and `src/components/common/ViewToggle.tsx` (links "Chat" → `/n/{lastNodeId}` or `/`, "Map" → `/map`)
- [X] T021 Create the integration test setup in `tests/integration/setup.ts`: set `DATABASE_URL` to `TEST_DATABASE_URL`, run migrations once, `TRUNCATE node_summaries, branch_markers, messages, nodes, trees RESTART IDENTITY CASCADE` before each test, reset fake mode to `ok`; plus `tests/integration/helpers.ts` with `call(method, path, body?)` that invokes route handlers directly with a `Request` whose `Host` is `127.0.0.1:3000`

**Checkpoint**: `docker compose up -d && pnpm db:migrate && pnpm test` passes with an empty suite; the app shell loads at `http://127.0.0.1:3000`

---

## Phase 3: User Story 1 — Start a root conversation (Priority: P1) 🎯 MVP

**Goal**: Start any number of independent root conversations and chat with the AI in them,
with retry on failure and regeneration of the latest reply

**Independent Test**: Empty database → start a conversation, exchange messages → start a
second root → both exist with no parent; reload → both persist

### Tests for User Story 1

- [X] T022 [P] [US1] Integration tests in `tests/integration/us1-conversations.test.ts`: `POST /api/trees` creates a tree whose root has `parentId: null`, `anchorText: null`, `isRoot: true`, and does not change other trees; `POST /api/nodes/{id}/messages` stores a user message (`provenance: "user_authored"`) and an AI message (`provenance: "ai_suggested"`, `status: "complete"`) with consecutive `seq`; in fake `fail` mode it returns `503 ai_unavailable` and the user message is still returned by `GET /api/nodes/{id}`; retry succeeds after switching back to `ok`; regenerate on the latest AI message returns a new message and the old row has `replaced_at` set and `replaced_by` = new id; regenerate on an older AI message returns `409 not_latest_ai_message`; requests with `Origin: https://evil.example` get `403`
- [X] T023 [P] [US1] Playwright test `tests/e2e/us1-root.spec.ts` for quickstart scenario 1 (chat part): start conversation, send "Tell me about Kubernetes Pods", AI reply visible and labelled as AI; start a second root; reload the page and both conversations are reachable

### Implementation for User Story 1

- [X] T024 [US1] Implement `createRootTree()` in `src/server/forest/trees.ts`: in one transaction insert the tree (with `root_node_id` set, relying on the deferred constraint) and its root node (`parent_id: null`, `provenance: 'user_authored'`); initial origin `x` = (max existing `layout_origin_x`, or −2000 if none) + 2000, `y` = 0 (the client relocates on overlap, US3)
- [X] T025 [US1] Implement `getNodeView(nodeId)` in `src/server/forest/nodeView.ts` returning the `GET /api/nodes/{nodeId}` response shape: node as `MapNode`, `anchor: null`, `inheritedContext: []`, non-replaced messages ordered by `seq`, `markers: []`, and `canRegenerate` = the latest non-replaced message if it is a `complete` AI message with no markers pointing at it (else `null`); summary placeholder via `placeholderFor(node)` in `src/server/summaries/placeholder.ts` (root → `"New conversation"`)
- [X] T026 [US1] Implement `buildReplyInput(nodeId)` in `src/server/messages/replyInput.ts` returning `{ inheritedContext: [], anchorText: null, messages }` from the node's non-replaced `complete` messages (extended in US2)
- [X] T027 [US1] Implement `sendMessage(nodeId, content)` in `src/server/messages/send.ts`: reject empty/whitespace content (`422`); lock the node row (`SELECT … FOR UPDATE`), allocate `seq = max(seq)+1`, insert the user message (`role 'user'`, `status 'complete'`, `provenance 'user_authored'`) and a `pending` AI message (`provenance 'ai_suggested'`, empty content); call `provider.reply(buildReplyInput(nodeId))`; on success write content and set `status 'complete'` (the only write to `content`, FR-028); on `AIUnavailableError` set `status 'failed'` and throw `AIServiceUnavailable` carrying the stored user message
- [X] T028 [US1] Implement `retryReply(messageId)` in `src/server/messages/retry.ts`: only for a `failed` AI message that is the node's latest; insert a new `pending` AI message, set the failed row's `replaced_at`/`replaced_by`, then complete it as in T027
- [X] T029 [US1] Implement `regenerateReply(messageId)` in `src/server/messages/regenerate.ts`: `409 not_latest_ai_message` unless it is the latest non-replaced `complete` AI message; `409 has_branches` if any `branch_markers.message_id` equals it; generate the new reply first, then in one transaction insert it (same `seq`) and set the old row's `replaced_at = now()`, `replaced_by = new.id`; on `AIUnavailableError` change nothing and throw `AIServiceUnavailable` (FR-029, FR-030)
- [X] T030 [US1] Add route handlers using `withApi`: `src/app/api/trees/route.ts` (POST → `201`), `src/app/api/nodes/[nodeId]/route.ts` (GET), `src/app/api/nodes/[nodeId]/messages/route.ts` (POST → `201`), `src/app/api/messages/[messageId]/retry/route.ts` (POST), `src/app/api/messages/[messageId]/regenerate/route.ts` (POST)
- [X] T031 [P] [US1] Implement `src/components/chat/Message.tsx`: renders message content with `react-markdown` plus a rehype plugin in `src/components/chat/rehypeSourceOffsets.ts` that wraps every text node in `<span data-start data-end>` using the hast node's source `position.start.offset`/`position.end.offset`; the message root carries `data-message-id` and `data-role`; AI messages show an "AI" label; pending shows a typing indicator; failed shows "Couldn't get a reply" with a Retry button calling the retry endpoint
- [X] T032 [US1] Implement `src/components/chat/Composer.tsx`: textarea bound to `viewStore.byNode[nodeId].draft`; Enter sends, Shift+Enter newline; clears the draft only after a `201`; on `503` keeps the draft and shows "AI service unavailable — Retry" (FR-032)
- [X] T033 [US1] Implement the chat page `src/app/n/[nodeId]/page.tsx` and `src/components/chat/ChatView.tsx`: loads `GET /api/nodes/{nodeId}`, renders the message list with `Message` and `Composer`, shows a "Regenerate" button on the message named by `canRegenerate`, sets `viewStore.lastNodeId`, and writes the list's `scrollTop` to `viewStore` on scroll (throttled 100 ms)
- [X] T034 [US1] Implement the home page `src/app/page.tsx`: with no trees, an empty state with a "Start a conversation" button (same action as `NewConversationButton`); otherwise redirect to `/n/{lastNodeId}` or the most recently created node

**Checkpoint**: US1 works on its own: chat in multiple root conversations, with retry and regenerate

---

## Phase 4: User Story 2 — Branch from a highlighted fragment (Priority: P1)

**Goal**: Highlight text in any message and branch an independent conversation from it, with a
persistent marker in the parent and the parent's context carried into the branch

**Independent Test**: Highlight a phrase, branch, chat in the branch, return to the parent: the
marker sits on the exact phrase and both conversations continue independently

### Tests for User Story 2

- [X] T035 [P] [US2] Unit tests in `tests/unit/selection.test.ts` for `selectionToAnchor` (T041) using jsdom fixtures: a selection inside one message maps to correct raw offsets across bold/italic/code spans; prefix/suffix are ≤ 32 chars; empty, whitespace-only and cross-message selections return `null`
- [X] T036 [P] [US2] Integration tests in `tests/integration/us2-branching.test.ts`: branching returns a child in the parent's tree with `parentId` = parent and a marker whose `anchorText` equals `content.slice(start, end)`; `422 invalid_selection` for empty/whitespace text, out-of-range offsets, `text` not matching the substring, and a message from another node; `409 message_not_branchable` for pending, failed and replaced messages; two overlapping branches on one message produce two markers and two children; branching from a child works (3 levels); the child's `inheritedContext` contains parent messages only up to and including the anchor message, and parent messages sent after branching never appear; the fake provider's recorded `ReplyInput` for the child includes that context and the anchor text; regenerating a reply that has a marker returns `409 has_branches`; child messages never appear in the parent
- [X] T037 [P] [US2] Playwright test `tests/e2e/us2-branch.spec.ts` for quickstart scenario 2: highlight "Containers" in an AI reply, click Branch, the child shows the quoted anchor and inherited context and waits for input (no AI message appears until the user sends one); the parent shows a marker on exactly "Containers" that opens the child; an overlapping second branch yields two markers; branching from the child works

### Implementation for User Story 2

- [X] T038 [US2] Implement `createBranch(parentNodeId, anchor)` in `src/server/forest/branch.ts`: load the message and require `message.node_id = parentNodeId`, `status = 'complete'`, `replaced_at IS NULL` (else `409 message_not_branchable`); require `0 <= start < end <= content.length`, `anchor.text.trim() !== ""`, `content.slice(start, end) === anchor.text` (else `422 invalid_selection`); in one transaction insert the child node (`tree_id` = parent's `tree_id`, `parent_id` = parent, `provenance 'user_authored'`) and the marker (`prefix`/`suffix` "up to 32 chars", `provenance 'user_authored'`); never call the AI provider (FR-004, Article IV)
- [X] T039 [US2] Implement `getInheritedContext(nodeId)` in `src/server/forest/inheritedContext.ts`: a recursive CTE walking `parent_id` to the root, joined with each step's incoming `branch_markers` to find the cut message; return `{ nodeId, messages }[]` oldest ancestor first, where each ancestor contributes its non-replaced `complete` messages with `seq` ≤ the seq of the message holding the next branch point (FR-005)
- [X] T040 [US2] Extend `getNodeView` in `src/server/forest/nodeView.ts` to return the node's `anchor` (from its incoming marker), `inheritedContext` (T039) and `markers` (all markers with `parent_node_id` = node); branch placeholder becomes `“<anchor text, truncated to 60 chars>”` in `src/server/summaries/placeholder.ts`; extend `buildReplyInput` in `src/server/messages/replyInput.ts` to include the flattened inherited context and `anchorText`
- [X] T041 [P] [US2] Implement `selectionToAnchor(selection, content)` in `src/components/chat/selection.ts`: both ends must be inside the same `[data-message-id]` element; map each end to a raw offset via the enclosing `span[data-start]` plus the offset inside its text node; return `null` for empty/whitespace or cross-message selections; return `{ messageId, start, end, text: content.slice(start, end), prefix, suffix }`
- [X] T042 [US2] Implement `src/components/chat/BranchAction.tsx`: on `selectionchange` inside the message list, if `selectionToAnchor` returns an anchor for a `complete` message, show a floating "Branch" button next to the selection; on click `POST /api/nodes/{nodeId}/branches` and navigate to `/n/{childId}`; add the route handler `src/app/api/nodes/[nodeId]/branches/route.ts` (`201`)
- [X] T043 [US2] Render markers in `src/components/chat/Message.tsx` via `src/components/chat/markerRanges.ts`: split text spans at every marker boundary and apply layered highlight classes so overlapping markers stay visible; each highlighted range is clickable and opens its child (when ranges overlap, show a small menu listing each child's placeholder/summary); markers persist across reloads (FR-006, FR-007)
- [X] T044 [US2] Implement `src/components/chat/InheritedContext.tsx` and show it at the top of `ChatView` for branches: the quoted anchor text, a "Back to parent" link to `/n/{parentId}`, and the inherited messages read-only in a visually separate, collapsible panel (export `INHERITED_CONTEXT_DEFAULT_COLLAPSED = true` so design can flip it, FR-033); inherited messages render without `data-message-id` so they cannot be branched from

**Checkpoint**: US1 and US2 work: multi-level trees built entirely by highlight-and-branch

---

## Phase 5: User Story 3 — See the forest as a map (Priority: P2)

**Goal**: A map of every tree with parent–child lines, distinct roots, separate trees and
current labels; growing one tree never moves another

**Independent Test**: Two roots, one branched to five nodes over three levels → map shows all
nodes, lines, root styling and two separate trees; adding a node leaves the other tree's
positions unchanged

### Tests for User Story 3

- [X] T045 [P] [US3] Unit tests in `tests/unit/layout.test.ts`: `layoutTree` is deterministic for the same input; `layoutForest` recomputes only trees whose node set changed; when a growing tree's bounding box (plus 80-unit gap) overlaps another tree, only the growing tree is relocated and is returned in `relocations`; every other tree's node positions are identical before and after (SC-007)
- [X] T046 [P] [US3] Integration tests in `tests/integration/us3-forest.test.ts`: `GET /api/forest` returns every tree and node with correct `parentId`, `isRoot`, `anchorText` and placeholder summaries; `PUT /api/trees/{id}/origin` persists finite `x`/`y`, returns `422` for non-finite values and `404` for unknown trees
- [X] T047 [P] [US3] Playwright test `tests/e2e/us3-map.spec.ts` for quickstart scenario 3, reading node positions, styles and edges from `window.__farabiMapDebug` (T052): 5 nodes, 3 edges, roots flagged as roots, trees' bounding boxes disjoint; record tree 2 positions, add a branch in tree 1, positions of tree 2 unchanged

### Implementation for User Story 3

- [X] T048 [US3] Implement `getForest()` in `src/server/forest/forest.ts`: all trees and nodes, each node's incoming anchor text, and its current summary via `SELECT DISTINCT ON (node_id) … ORDER BY node_id, created_at DESC` on `node_summaries`, falling back to `placeholderFor(node)`; add `setTreeOrigin(treeId, x, y)`; add route handlers `src/app/api/forest/route.ts` (GET) and `src/app/api/trees/[treeId]/origin/route.ts` (PUT)
- [X] T049 [P] [US3] Implement `src/map/forestGraph.ts`: build a graphology `DirectedGraph` from the forest response (node attributes: `treeId`, `isRoot`, `summary`; edges parent → child) and `diffForest(prev, next)` returning added nodes, changed summaries and changed tree ids
- [X] T050 [P] [US3] Implement `layoutTree(graph, rootId)` in `src/map/layout/treeLayout.ts`: build a `d3-hierarchy` hierarchy from graphology out-neighbours (children ordered by `createdAt`), apply `tree().nodeSize([220, 120])`, return positions relative to the root and the tree's bounding box
- [X] T051 [US3] Implement `layoutForest(graph, trees, changedTreeIds, cache)` in `src/map/layout/forestLayout.ts`: reuse cached layouts for unchanged trees; offset each tree by its persisted origin; if a changed tree's box (with 80-unit gap) overlaps any other tree, move only that tree to the first free position to the right of the rightmost existing box at `y = 0`; return `{ positions, boxes, relocations }`
- [X] T052 [US3] Implement the imperative renderer `src/map/MapRenderer.ts` (no React imports): PixiJS `Application` + `pixi-viewport` (drag, wheel zoom, pinch); methods `mount(el)`, `setForest(forest)`, `updateSummaries(changes)`, `focusNode(id)`, `onNodeClick(cb)`, `destroy()`; draws edges as lines parent → child, roots as larger filled rounded rectangles and branches as outlined rectangles (FR-019); AI summaries in regular text with a small "AI" tag, placeholders in italic muted text with no tag (FR-011, FR-014); when `NODE_ENV !== "production"` exposes `window.__farabiMapDebug = { nodes: [{ id, treeId, x, y, isRoot, labelKind }], edges, treeBoxes }`
- [X] T053 [US3] Implement `src/components/map/MapHost.tsx` and render it once in `src/app/layout.tsx`, visible only when the path is `/map` (hidden with CSS otherwise, so the renderer stays mounted, research R7): creates one `MapRenderer`, fetches `GET /api/forest` whenever it becomes visible, runs `layoutForest` for changed trees, persists each relocation with `PUT /api/trees/{id}/origin`; create `src/app/map/page.tsx` as an empty route so `/map` exists

**Checkpoint**: Map shows the whole forest accurately; other trees never move

---

## Phase 6: User Story 4 — Jump back into a conversation from the map (Priority: P2)

**Goal**: Click any map node to open its conversation exactly where it was left

**Independent Test**: Scroll up in a long conversation and type a draft → map → click that
node → same scroll position and draft; click another node → it opens

**Depends on**: US3 (map exists)

### Tests for User Story 4

- [X] T054 [P] [US4] Playwright test `tests/e2e/us4-roundtrip.spec.ts` for quickstart scenario 4: seed a conversation with 30 messages, scroll to a known message, type an unsent draft, go to `/map`, click the node → the same message is at the top of the viewport (±1 message) and the draft is intact; click another node → its conversation opens; branching still works after returning

### Implementation for User Story 4

- [X] T055 [US4] In `src/components/map/MapHost.tsx`, register `renderer.onNodeClick(id => router.push("/n/" + id))`, and highlight the node for `viewStore.lastNodeId` via `focusNode` when the map becomes visible
- [X] T056 [US4] In `src/components/chat/ChatView.tsx`, restore `viewStore.byNode[nodeId].scrollTop` in a `useLayoutEffect` after the messages first render (default: scrolled to bottom for a node never visited), and make sure `Composer` reads the stored draft on mount
- [X] T057 [P] [US4] Add a client cache in `src/lib/nodeCache.ts` (last 20 `GET /api/nodes/{id}` responses) used by `ChatView` to render instantly from cache and then revalidate, so node-to-chat navigation stays under 1 s (SC-006)

**Checkpoint**: chat → map → chat round trips preserve state

---

## Phase 7: User Story 5 — Summaries follow the conversation as it drifts (Priority: P3)

**Goal**: Each node's one-sentence summary regenerates in the background from its own messages
and updates on the map without user action

**Independent Test**: Branch on a narrow phrase, steer to a new topic, open the map → the label
reflects the latest messages; typing stays smooth while summaries run

### Tests for User Story 5

- [X] T058 [P] [US5] Integration tests in `tests/integration/us5-summaries.test.ts`: after a completed reply, the refresh queue inserts a `node_summaries` row with `provenance 'ai_suggested'` and `through_message_id` = the latest message; the fake provider's recorded `SummaryInput` for a branch contains only the branch's own messages and its anchor, never inherited context (FR-012); in `fail` mode no row is written and the previous summary stays current; a node with no completed AI reply shows its placeholder; `POST /api/nodes/{id}/summary/refresh` returns `202 { queued: true }` immediately even in `slow` mode
- [X] T059 [P] [US5] Playwright test `tests/e2e/us5-drift.spec.ts` for quickstart scenario 5: branch on "Containers", send messages ending on a new topic, open the map → the node's label matches the fake summary of the last message within 10 s (SC-003); with the fake provider in `slow` mode (5 s), typing 50 characters in the composer shows every character with under 100 ms delay (SC-004)

### Implementation for User Story 5

- [X] T060 [US5] Implement `buildSummaryInput(nodeId)` in `src/server/summaries/summaryInput.ts`: takes only a node id, reads only that node's non-replaced `complete` messages and its own anchor text; it MUST NOT import or call `getInheritedContext` (contracts/ai-provider.md rule)
- [X] T061 [US5] Implement the in-process queue in `src/server/summaries/queue.ts`: `enqueueSummary(nodeId)` coalesces repeated requests per node, runs at most 2 jobs concurrently off the request path, calls `provider.summarize(buildSummaryInput(nodeId))`, inserts a `node_summaries` row (`provenance 'ai_suggested'`, `through_message_id` = latest included message); on `AIUnavailableError` logs and writes nothing; mark the module with a comment that trigger timing and job mechanism are pending research R10
- [X] T062 [US5] Trigger summaries: call `enqueueSummary(nodeId)` without awaiting after every successful completion in `src/server/messages/send.ts`, `src/server/messages/retry.ts` and `src/server/messages/regenerate.ts` (interim choice matching FR-012 until R10 is decided); add `src/app/api/nodes/[nodeId]/summary/refresh/route.ts` (POST → `202`)
- [X] T063 [US5] Live map labels: in `src/components/map/MapHost.tsx`, poll `GET /api/forest` every 3 s while the map is visible and pass summary changes from `diffForest` to `renderer.updateSummaries` without re-running layout
- [X] T064 [P] [US5] Show the node's current summary (or placeholder) in a header `src/components/chat/NodeHeader.tsx` rendered by `ChatView`, with the same "AI" tag and placeholder styling as the map (FR-014: marked wherever it appears)

**Checkpoint**: All five stories work independently and together

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T065 [P] Create `scripts/seed-large.ts`: inserts 20 trees with 500 nodes total (random branching up to depth 6), 4 messages per node, markers for every branch and one summary per node, directly via Kysely
- [X] T066 [P] Playwright test `tests/e2e/scale.spec.ts` for quickstart scenario 8 after running the seed: `/map` shows all 500 nodes within 1 s and clicking a node opens its conversation within 1 s (SC-006)
- [X] T067 [P] Constitution guard tests in `tests/integration/constitution.test.ts`: no file under `src/app/api/**/route.ts` exports `DELETE` or `PATCH` (Article II); every `node_summaries` row has `provenance = 'ai_suggested'` and every AI message has `provenance = 'ai_suggested'` (Article I); no server module other than the message services calls `provider.reply`, and no provider call creates nodes (Article IV)
- [X] T068 [P] Playwright test `tests/e2e/regenerate-offline.spec.ts` for quickstart scenarios 6 and 7: regenerate replaces the latest reply and disappears after branching from it; with the fake provider in `fail` mode, sending shows the error with Retry, the draft is kept, and the map and other conversations still open
- [X] T069 [P] Write `README.md` with the prerequisites and run commands from quickstart.md
- [X] T070 Run every quickstart.md scenario and the full test suite (`pnpm lint && pnpm test && pnpm test:e2e`); fix failures

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none
- **Foundational (Phase 2)**: after Setup; blocks all stories
- **US1 (Phase 3)**: after Foundational
- **US2 (Phase 4)**: after US1 (branches are made from messages in the chat view)
- **US3 (Phase 5)**: after Foundational for the server/layout parts (T045–T051 can start in
  parallel with US1); the e2e test T047 and T053 need US1 and US2 to create trees and branches
- **US4 (Phase 6)**: after US3 (needs the map) and US1 (chat view)
- **US5 (Phase 7)**: after US1; T063 needs US3
- **Polish (Phase 8)**: after the stories it covers

### Story completion order

```text
Setup → Foundational → US1 → US2 ─┬→ US3 → US4
                                  └→ US5 (map labels need US3)
```

### Within each story

Tests first (they should fail), then server logic, then route handlers, then UI.

## Parallel Opportunities

- Setup: T003, T004, T005, T006
- Foundational: T011–T015, T017–T019 after T008–T010
- US1: T022, T023, T031 alongside server work T024–T029
- US2: T035, T036, T037, T041
- US3: T045, T046, T049, T050 (can start as soon as Foundational is done)
- US5: T058, T059, T064
- Polish: T065–T069

## Parallel Example: User Story 2

```bash
Task: "Unit tests for selectionToAnchor in tests/unit/selection.test.ts"
Task: "Integration tests for branching in tests/integration/us2-branching.test.ts"
Task: "Playwright branch test in tests/e2e/us2-branch.spec.ts"
Task: "Implement selectionToAnchor in src/components/chat/selection.ts"
```

## Implementation Strategy

### MVP first

1. Setup + Foundational
2. US1 → validate: multiple root chats with retry and regenerate
3. US2 → validate: branching with markers and inherited context (the product's core)
4. Stop and demo: US1 + US2 is the smallest useful product

### Incremental delivery

5. US3 → the map
6. US4 → map ↔ chat round trips
7. US5 → live, drift-following summaries
8. Polish → scale, constitution guards, docs

### Deferred (research R10)

Real Claude provider, streaming transport, final summary trigger and job mechanism. The fake
provider and in-process queue (T015, T061, T062) are the seams to replace.

## Implementation notes (2026-09-27)

- npm is used instead of pnpm (pnpm unavailable); scripts are `npm run dev`, `npm test`, etc.
- `@rolldown/binding-darwin-arm64` is an optional dependency to work around an npm
  optional-dependency bug that stopped Vitest from starting.
- Browser tests run against a production build on port 3100 in full Chromium with GPU;
  test-only hooks are enabled there by `FARABI_TEST_HOOKS` / `NEXT_PUBLIC_FARABI_TEST_HOOKS`.
- Map labels use PixiJS `BitmapText`, and the renderer is lazy-loaded and prepared during idle
  time so chat pages don't ship PixiJS and the first map visit is instant (T052, T053).
- SC-004 is checked on keystroke handler processing time (Event Timing), because headless
  painting adds delay even to a bare textarea.

## Notes

- [P] tasks touch different files and have no dependency on incomplete tasks
- Commit after each task or logical group
- Stop at any checkpoint to validate a story on its own
