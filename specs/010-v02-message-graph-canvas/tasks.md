---
description: "Task list for Farabi v0.2: Message Graph and Canvas"
---

# Tasks: Farabi v0.2 — Message Graph and Canvas

**Input**: design documents in `specs/010-v02-message-graph-canvas/`: [spec.md](./spec.md),
[plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/http-api.md](./contracts/http-api.md), [contracts/migration.md](./contracts/migration.md),
[contracts/canvas-ui.md](./contracts/canvas-ui.md),
[contracts/declarations.md](./contracts/declarations.md) and [quickstart.md](./quickstart.md).

**Tests**: included, as in earlier features. Write each story's tests first and watch them fail.

**Format**: `[ID] [P?] [Story] Description`. `[P]` means the task can run in parallel, because it
touches different files and has no unfinished dependencies.

**Before starting**:

- Work on branch `v0.2` (or a branch off it).
- Read `node_modules/next/dist/docs/` for route handlers, redirects and dynamic pages before
  writing any route (`AGENTS.md`).
- **Open decision**: conversation-level hand placements from v1 are kept as data and not applied
  (research R4). If the owner chooses the "placed run" alternative, T067 and T028 change before
  US4 starts.

---

## Phase 1: Setup

- [X] T001 Update `package.json`:
  - Add direct dependencies at the installed versions: `"unified": "^11.0.5"` and
    `"remark-parse": "^11.0.0"`. No new packages (plan Technical Context). `remark-rehype` turned
    out to be unnecessary, because the parser reads mdast directly.
  - Add scripts `"v1:convert": "tsx scripts/v1-convert.ts"` and
    `"v1:verify": "tsx scripts/v1-verify.ts"`.
  - Run `npm install` so `package-lock.json` records them as direct.
- [X] T002 [P] Add `/db/backups/` to `.gitignore` (research R3).
- [X] T003 [P] Create the folders `src/canvas/{layout,renderer,text,overlays}/`,
  `src/server/graph/`, `src/server/answers/` and `src/server/db/v1/`, each with a one-line
  `README.md` naming what lives there (plan Structure Decision).

---

## Phase 2: Foundational (blocking)

**Purpose**: The scale gate, the v2 schema and the shared server and client core that every story
uses. **No story work starts until this phase is done, and M0 (T004–T011) must pass first.**

### Gate M0: scale proof (research R7–R9, R17; quickstart §0)

- [X] T004 [P] Implement `src/canvas/text/richText.ts`:
  - `parseRichText(source: string): RichText` with the unified + remark-parse
    pipeline.
  - **Output**: `blocks: Array<{ tag: "p"|"h1"…"h6"|"li"|"pre"|"blockquote", depth, runs: Array<{ start, end, marks: Set<"strong"|"em"|"code"> }> }>`.
  - **Offsets**: each run's `start` and `end` are raw offsets in `source`. Only text whose source
    maps 1:1 onto its value gets a run, the same rule as `src/components/chat/rehypeSourceOffsets.ts`.
  - **Cache**: `richTextFor(id, source)` memoizes by `id + source.length`.
  - `clip(rich, budget)` returns the block and run prefix whose character total ≤ budget. It cuts
    the last run at a word boundary and reports `clipped: boolean`.
- [X] T005 [P] Implement `src/canvas/text/budget.ts`:
  - `allocate(items: Array<{ id, screenArea, fullChars, pinned }>, total, floor): Map<id, chars>`, with defaults of 30,000 and 6 as measured in M0 (research R17).
  - **Rules**:
    - shares are proportional to `screenArea`
    - every visible item gets at least `min(floor, fullChars)`
    - pinned items always get `fullChars`
    - no item gets more than `fullChars`
    - the sum never exceeds `total` plus the pinned characters
- [X] T006 [P] Unit tests in `tests/unit/f10-richtext.test.ts`:
  - paragraphs, headings, lists, bold, emphasis, inline code and escapes
  - every run's `source.slice(start, end)` equals its rendered text
  - `clip` respects the budget and cuts at word boundaries
- [X] T007 [P] Unit tests in `tests/unit/f10-budget.test.ts`:
  - proportionality
  - the 24-character floor
  - pinned items get their full text
  - the total is capped
  - 5,000 items allocate in < 2 ms
- [X] T008 Implement `src/canvas/text/TextLayer.ts` (research R7, R8; canvas-ui.md "Mounting and
  clipping"):
  - **Container**: a `div[data-testid=text-layer]` over the canvas with `pointer-events: none`.
    `setTransform(scale, tx, ty)` writes one `matrix()` per frame.
  - **Items**: `div[data-testid=element-text][data-node-id]`, absolutely positioned in world units
    with `contain: layout paint style` and `pointer-events: auto`.
  - `update(viewport, elements, boxes)`:
    1. Compute the visible set (box intersects viewport plus half-screen overscan, brute force).
    2. Allocate budgets with `budget.allocate`.
    3. Mount, recycle or unmount item DOM. Unmounts are debounced to camera idle (120 ms).
    4. Render runs as `span[data-start][data-end]`. The clipped item gets `data-clipped="true"` on
       its last span and a CSS fade.
  - **Pinning**: `pin(id, reason)` and `unpin(id, reason)`, for selection, composer or stream.
  - **Test hooks** (`NEXT_PUBLIC_FARABI_TEST_HOOKS` only): `window.__farabiTextStats()` returns
    `{ mounted, chars, pinned, offscreenMounted }`.
- [X] T009 Create the spike page `src/app/dev/canvas-spike/page.tsx`. It renders only when
  `FARABI_TEST_HOOKS=1`, and otherwise `notFound()`.
  - It builds `?n=` (default 5,000) synthetic elements in columns. Text lengths follow the
    real-data distribution (mean 1,700, max 8,000 characters, markdown with bold and lists).
  - A minimal PixiJS app with pixi-viewport draws their frames.
  - It drives `TextLayer` from the viewport's `moved` and `zoomed` events and the ticker in the
    same frame.
  - It exposes `__farabiFrameStats(ms)`, which samples `requestAnimationFrame` deltas and returns
    `{ p50, p95, max }`.
- [X] T010 E2E `tests/e2e/f10-m0-spike.spec.ts` (quickstart §0):
  1. Load `/dev/canvas-spike?n=5000` and measure time to first full render (< 1 s).
  2. Pan continuously for 5 s: p95 < 16.7 ms.
  3. Step-zoom from 0.02 to 4: p95 < 20 ms.
  4. At zoom 0.02, drag-select a visible word inside one item and assert
     `getSelection().toString()` is non-empty.
  5. After idle, `offscreenMounted === 0`.
- [X] T011 **Gate**:
  1. Run T010 on the owner's machine (`npx playwright test tests/e2e/f10-m0-spike.spec.ts`).
  2. Record p50, p95 and max for pan and zoom, plus open time and mounted characters, under R17 in
     `specs/010-v02-message-graph-canvas/research.md`.
  3. If it fails, apply the R17 fallbacks in order and re-measure. Stop and report to the owner
     before continuing if it still fails.

### Schema and declarations

- [X] T012 Create `src/server/db/migrations/0010_message_graph.ts`, forward-only with a `down()`
  that throws, following `0009_node_functions.ts`. Steps, in order (contracts/migration.md "Order
  inside the migration transaction"):
  1. **Freeze the originals.**
     - `CREATE SCHEMA v1`.
     - `ALTER TABLE … SET SCHEMA v1` for `trees`, `nodes`, `messages`, `branch_markers`,
       `node_summaries`, `edge_label_versions`, `parked_tangents`, `parked_tangent_events`, `pipes`,
       `function_output_versions`, `function_output_events` and `kind_setting_changes`.
     - Create the function `v1.frozen()` that raises `'% is frozen v1 data: % is not allowed'`.
     - Add a `BEFORE UPDATE OR DELETE FOR EACH ROW` trigger `v1_frozen` on each moved table.
  2. **Checksums.** Create `v1_checksums (table_name text PRIMARY KEY, row_count bigint NOT NULL, digest text NOT NULL, taken_at timestamptz NOT NULL DEFAULT now())`.
     Insert one row per moved table:
     `count(*)` and `md5(coalesce(string_agg(row_to_json(t)::text, '' ORDER BY <pk>), ''))`.
  3. **New tables**, exactly as data-model.md, with every constraint, index and trigger listed
     there:
     - `trees`
     - `nodes`, with its CHECKs, `UNIQUE (id, tree_id)`, the parent FK
       `(parent_id, tree_id) REFERENCES nodes(id, tree_id)` and
       `UNIQUE (tree_id) WHERE parent_id IS NULL`
     - `edge_notes`: `text CHECK length 1..200` or NULL, `provenance = 'user_authored'`
     - `output_reviews`
     - `kind_setting_changes`
     - `parked_tangents` and `parked_tangent_events`, the Feature 8 columns with `message_id`
       removed and `child_node_id` renamed `edge_id`
     - `project_cameras`: `scale CHECK 0.02..4`
     - `v1_conversion`, with
       `UNIQUE NULLS NOT DISTINCT (v1_table, v1_id, v2_id)`
  4. **Triggers on new tables.**
     - `nodes_shape_rule` (BEFORE INSERT): a content node's parent must be an edge.
     - `nodes_guard` (BEFORE UPDATE OR DELETE). DELETE raises. UPDATE is allowed only as exactly
       one of: (1) send, (2) checkpoint, (3) finalize, (4) placement, as data-model.md defines
       them. Everything else raises.
     - `edge_notes_edge_only`, and `output_reviews_output_only`, which requires the node to have
       `origin = 'run'` and shape `node`.
     - Append-only triggers on `edge_notes`, `output_reviews`, `kind_setting_changes`,
       `parked_tangents`, `parked_tangent_events` and `v1_conversion`. Keep
       `parked_events_terminal` unique on terminal events.
  5. **Additive changes to `definitions`.**
     - `ADD COLUMN source_id uuid REFERENCES nodes(id) ON DELETE RESTRICT`
     - `ALTER COLUMN source_node_id DROP NOT NULL`
     - `ALTER COLUMN source_message_id DROP NOT NULL`
     - `ADD CHECK (source_id IS NOT NULL OR source_node_id IS NOT NULL)`
  6. **Additive changes to `feedback_items`.**
     - `ALTER TYPE feedback_view ADD VALUE 'canvas'`
     - `ADD COLUMN project_id uuid REFERENCES projects(id)` and
       `ADD COLUMN element_id uuid REFERENCES nodes(id)`
     - Replace the constraint `feedback_items_node_only_in_chat` with
       `CHECK (node_id IS NULL OR view = 'chat')` and
       `CHECK (element_id IS NULL OR view IN ('chat','canvas'))`
  7. **Conversion.** `await convertV1(trx)` from `src/server/db/v1/convert.ts` (T013 stub, real in
     US4).
  8. **Backfills and report.** Backfill `definitions` and `feedback_items` (T068 in US4). Then
     replace `feedback_items_rank_only()` so it also freezes `project_id` and `element_id`. Print
     the report.
- [X] T013 Create `src/server/db/v1/convert.ts` with
  `export async function convertV1(trx): Promise<ConversionReport>`. For now it returns an empty
  report when every `v1.*` table is empty, and throws `"v1 conversion is not implemented yet"`
  otherwise. This makes running 0010 on real data impossible until US4 lands. Create
  `src/server/db/v1/schema.ts` with `V1Database` types copied from today's `schema.ts` for the
  moved tables.
- [X] T014 Rewrite `src/server/db/schema.ts` for v2:
  - **`NodesTable`**: every column in data-model.md, with `ColumnType` rules. `text` is insertable
    and updatable only through the guard paths, and `properties` is inserted as a JSON string.
  - **New table types**: `TreesTable` (`layout_origin_x`, `layout_origin_y`, `user_placed`),
    `EdgeNotesTable`, `OutputReviewsTable`, `KindSettingChangesTable`, `ParkedTangentsTable`,
    `ParkedTangentEventsTable` (`edge_id`), `ProjectCamerasTable`, `V1ConversionTable` and
    `V1ChecksumsTable`.
  - **Changes**: `DefinitionsTable` gains `source_id` (nullable), and `source_node_id` and
    `source_message_id` become nullable. `FeedbackItemsTable` gains `project_id` and `element_id`,
    and `FeedbackView` adds `"canvas"`.
  - **Remove** `MessagesTable`, `BranchMarkersTable`, `NodeSummariesTable`, `EdgeLabelVersionsTable`,
    `PipesTable`, `FunctionOutputVersionsTable` and `FunctionOutputEventsTable` from `Database`.
    They now live only in `V1Database`.
- [X] T015 [P] Rewrite the kind registry (contracts/declarations.md):
  - `src/shared/kinds/types.ts`: add `shape` and `display`, and drop `conversationBacked`, `view`
    and `mapLabel`.
  - `src/shared/kinds/index.ts`: registration also checks that display matches shape.
  - Add `src/shared/kinds/{question,answer,function}.ts`.
  - Update `src/shared/kinds/analogy.ts` (`shape: "node"`, `display: "output"`,
    `acceptsInputKinds: ["answer"]`).
  - Delete `src/shared/kinds/{conversation,pipe}.ts`.
- [X] T016 [P] Rewrite `src/shared/schemas.ts` with zod shapes from contracts/http-api.md "Shared
  shapes":
  - `Element`, `EdgeState`, `Review`, `Span`, `Tree`, `Camera`, `CanvasResponse`
  - every request and response body of the routes in http-api.md
  - `ParkedTangent` with `nodeId`, `anchor: Span`, `question` and `createdAt`
  - `Definition.source` as `{ elementId, kind, excerpt, projectId }`
  - `FeedbackView` with `"canvas"`

  Remove `MapNode`, `MapPipe`, `NodeView`, `Message`, `Marker`, `Summary`, `OutputVersion` and the
  forest shapes.
- [X] T017 Update `tests/integration/setup.ts`:
  - The `TRUNCATE` list becomes the v2 tables plus `definitions` and the feedback tables plus every
    `v1.*` table.
  - Add a fixture helper `seedV1(fixture)` in `tests/integration/fixtures.ts` that inserts into
    `v1.*` for conversion tests.

  Update `tests/e2e/helpers.ts` the same way, and add canvas helpers that wrap the hooks in
  canvas-ui.md "Test hooks".

### Server core

- [X] T018 Create `src/server/graph/elements.ts`:
  - **Inserts**: `insertElement(trx, { kind, parentId, treeId, projectId, origin, provenance, text?, … })`
    reads `shape` from the kind declaration and validates `properties` with `validateProperties`.
  - **Mapping**: `toElement(row, extras)` maps a row to `Element`.
  - **Edge state**: `edgeState(edge, newestAttempt)` follows research R5.
    - `text IS NULL` → `unsent`
    - the newest answer's status maps `pending` → `replying`, `complete` → `answered`, and the
      other three to themselves
    - a sent edge with no answer → `failed`
  - **Loading**:
    - `loadLive(trx, id)` joins trees and projects and refuses trashed projects with 404.
    - `newestAttempt(trx, edgeId)` returns the newest answer by `created_at`, then id.
  - `lockElement(trx, id)` does `SELECT … FOR UPDATE`.
- [X] T019 Create `src/server/answers/generation.ts` from `src/server/messages/generation.ts`,
  keyed by answer id:
  - finalize writes `status`, `text` and `partial_text = null` through the guard's finalize path
  - the checkpoint writes `partial_text` while pending
  - remove the `summaryAfterReply` call (FR-062)
  - keep `subscribe`, `stopGeneration`, `waitFor`, `finalizeOrphan` and `drainGenerations`

  Add `insertPendingAnswer(trx, edge)`, which records `pressure_level` and `reply_model` from
  `getSettings` (Feature 6) with `origin` `reply`, `retry` or `regenerate`.
- [X] T020 Create `src/server/graph/context.ts`:
  - `buildReplyInput(answerId)` uses a recursive CTE over `nodes.parent_id` from the answer's edge
    up to the origin (research R6).
  - **Turns**: a question edge becomes a user turn, and an answer becomes an AI turn only if its
    status is `complete`. Skip `function` and `analogy` kinds.
  - Fill `messages` in order with `inheritedContext: []`, and set `anchorText` from the edge's
    anchor.
  - Set `pressureLevel` and `model` from the answer row.
- [X] T021 Unit and integration tests for context in `tests/integration/f10-context.test.ts`:
  - a linear path
  - a branch from an answer span (anchor passed)
  - a branch from a question-edge span (the path includes that edge but not its answer)
  - two edges in a row
  - an incomplete answer excluded
  - a sibling attempt and a sibling branch never included (FR-007)
- [X] T022 Create `src/server/graph/canvas.ts` and `src/app/api/canvas/route.ts`.
  `GET /api/canvas?projectId=` returns `{ trees, elements, camera }` per http-api.md. Each element
  carries:
  - the derived `state`, `review` and current `note`
  - `functionName`, from the registry
  - `rootAnswerId` per tree

  Pending answers with no live generator are finalized through `finalizeOrphan` first. Use 4
  set-based queries: elements, newest notes, newest reviews, camera.
- [X] T023 [P] Update `src/server/errors.ts` and `src/server/http/withApi.ts` for the new 409
  codes:
  - `reply_in_progress`, `not_askable`, `not_branchable`, `already_sent`
  - `not_retryable`, `not_regenerable`, `not_an_edge`, `origin_edge`, `wrong_kind`
  - plus 503 `function_unavailable`

  Keep the error body shape.
- [X] T024 Rewrite `tests/integration/constitution.test.ts` with these guards:
  1. No DELETE or PATCH route handlers (kept).
  2. Every write path of `nodes_guard`: send twice → error; changing text after finalize → error;
     changing `parent_id`, `kind`, `anchor_*` or `provenance` → error; any DELETE → error; a
     placement update → ok.
  3. `v1.*` UPDATE and DELETE raise.
  4. No file under `src/` except `src/server/db/v1/**` and `src/server/db/migrations/0010_message_graph.ts`
     contains `v1.` or `V1Database`.
  5. Only `src/server/answers/` and `src/server/ai/` call `.reply(`.
  6. No file calls `.summarize(` except `src/server/ai/*` (SC-014).
  7. After an ask, every answer is `ai_suggested` and every question edge is `user_authored`
     (SC-015).
  8. `src/server/functions/runner.ts` contains no function or kind id string literal (SC-013).

### Client core

- [X] T025 [P] Create `src/canvas/store.ts`, a zustand store with:
  - `elements: Map`, `trees`, `projectId`
  - `focusId`, `selection` (element id and span)
  - `drafts: Record<targetId, string>`, persisted to localStorage as `farabi.drafts`
  - `showRejected` and `minimapHidden`, persisted under `farabi.settings`
  - actions `load(canvas)`, `merge(elements)`, `focus(id)` and `setDraft`
- [X] T026 [P] Create `src/canvas/graph.ts`:
  - build a graphology `DirectedGraph` from elements (`parent → child`)
  - `merge` adds elements incrementally and reports `changedTreeIds`
  - `ancestors(id)` and `children(id)`, ordered by `createdAt` then id
  - `firstChild(id)`: the earliest child that isn't an anchored branch
- [X] T027 [P] Create `src/canvas/layout/heights.ts`:
  - `estimateHeight(element)` uses canvas `measureText` with the canvas font
    (OpenDyslexic, sizes from `globals.css`) at the kind's width:
    - answer: 480
    - question: 360
    - analogy: 320
  - Word widths are cached, and block and line spacing follow the CSS.
  - `recordMeasured(id, px)` stores into memory and into localStorage under
    `farabi.heights.v1:<id>`.
  - `heightOf(id)` prefers the measured value. Function edges have no box.
- [X] T028 Rewrite `src/canvas/layout/treeLayout.ts` as a first-child-aligned tidy tree (research
  R10):
  - variable box sizes from `heights` and kind widths
  - the first child sits directly below its parent (gap 24 between bubble and answer, 40 between
    answer and the next bubble)
  - later children (branches, re-asks, extra attempts, function edges) are placed to the right with
    contours kept 48 apart
  - hand-placed elements override only their own position
  - an anchored branch's connector origin is `parentY + start / length × parentHeight`

  Move `src/map/layout/forestLayout.ts` to `src/canvas/layout/forestLayout.ts` unchanged in its
  tree-placement rules (Feature 2 FR-020, FR-023).
- [X] T029 [P] Unit tests in `tests/unit/f10-layout.test.ts`:
  - a 6-element run is one column
  - a sibling edge goes to the right and the column doesn't move
  - deep fan-outs never overlap
  - hand placement moves only that element
  - adding to one tree leaves every other tree's positions and every hand-placed element
    unchanged (SC-009)
  - a streaming height change moves only later elements of the same column
- [X] T030 Create `src/canvas/renderer/CanvasRenderer.ts` from `src/map/MapRenderer.ts`:
  - Keep the Pixi Application and pixi-viewport setup and palettes.
  - Draw frames per display (canvas-ui.md "Elements as drawn") with no text: no BitmapText
    anywhere.
  - Draw connectors parent → child, function connectors dashed or solid by review, the focus ring,
    and the path emphasis (focused ancestors at full contrast, the rest at 45% alpha).
  - Expose these hooks:
    - `onFrameClick(id)`
    - `onFrameDrag(id, phase, world)` and `onTreeDrag`
    - `elementScreenRect(id)`
    - `worldToScreen` and `screenToWorld`
    - `onCameraChange(cb)`, fired in the same frame as the render
  - Expose the test hooks `__farabiCanvasDebug` and `__farabiScreenPoint`.
- [X] T031 Create `src/canvas/camera.ts`, the follow and free state machine (research R11):
  - `follow(targetId)` glides with `viewport.animate` (350 ms, or instant with reduced motion) to
    fit the target's box.
  - While following a streaming answer, it re-fits on height change.
  - `onManual()` sets `free`.
  - `relayoutCompensate(dx, dy)` applies only in follow mode.
  - The clamp is 0.02..4, and the project bounds stay ≥ ¼ of the screen.
  - `moves` counter.
  - The test hook `__farabiCamera()`.
- [X] T032 [P] Unit tests in `tests/unit/f10-camera.test.ts`:
  - a send or walk → follow and one glide
  - a manual wheel → free
  - while free, elements added, a relayout, a function output or another tree changing → 0
    moves (SC-008)
  - the next walk → follow again
- [X] T033 Create `src/canvas/input.ts` (canvas-ui.md "Pointer, wheel and keyboard"):
  - **Wheel**: a plain wheel pans and Ctrl or Cmd plus wheel zooms at the pointer. Wheel events on
    the text layer are forwarded to the viewport with `preventDefault`.
  - **Drag**: background drag pans, frame drag moves the element (Alt moves the tree), and a
    4 px threshold separates click from drag.
  - **Text**: a press on text never starts a drag.
  - **Camera**: every manual input calls `camera.onManual()`.
  - **Keys**: `Alt+↑`, `Alt+↓`, `Alt+←` and `Alt+→` walk, `Esc` clears the selection and `/`
    focuses the composer.
- [X] T034 Create `src/canvas/CanvasHost.tsx`, a client component that:
  - mounts `CanvasRenderer`, `TextLayer`, the camera and input
  - loads `GET /api/canvas`
  - lays out with `forestLayout` and `treeLayout`, and feeds boxes to the renderer and text layer
    in one frame
  - keeps the text-layer transform in step through `onCameraChange` and exposes
    `__farabiCanvasDrift()`
  - refetches on window focus and every 10 s while visible (research R13)
  - renders the overlays slot
- [X] T035 Rewrite `src/app/page.tsx`: resolve the project from the cookie (as today) and render
  `<CanvasHost projectId focus={searchParams.focus} span={searchParams.span} />`. Update
  `src/app/layout.tsx`: remove `ViewToggle`, `NewConversationButton` and `MapHost`, and keep
  `ProjectMenu`, `SettingsLink` and `Feedback*`.
- [X] T036 [P] Rewrite `src/lib/api.ts` with client methods for every route in
  contracts/http-api.md, and remove the chat and map methods. Update `src/lib/replyStream.ts` to
  stream by answer id (`/api/answers/{id}/stream`).

**Checkpoint**: M0 passed. 0010 runs on an empty database, the canvas opens empty, and the
foundational unit and constitution tests are green.

---

## Phase 3: User Story 1 — Ask on the canvas and watch the answer arrive (P1) 🎯 MVP

**Goal**: Type a question in a project, see an origin edge and a streaming answer, and extend the
path with follow-ups. The camera follows.

**Independent test**: In an empty project, send a question. An origin edge and a streaming answer
appear. Send a follow-up, and a second edge and answer extend the column with the camera
following (quickstart §3.1).

### Tests (write first)

- [X] T037 [P] [US1] Integration tests in `tests/integration/f10-graph.test.ts` (asking part):
  - `POST /api/trees` creates a tree, an origin edge (parent null, `user_authored`) and a pending
    answer (`ai_suggested`).
  - `?wait=1` → answered.
  - `POST /api/nodes/{answer}/ask` creates an edge child and an answer.
  - Asking again from the same answer creates a sibling, and the first edge is unchanged
    (FR-013).
  - Ask from a pending answer's parent edge → 409 `reply_in_progress`.
  - Fake offline mode → the answer becomes failed, and the edge text is stored.
  - Stop keeps text as `stopped`.
  - Any text is accepted for an origin edge (FR-014).
- [X] T038 [P] [US1] E2E `tests/e2e/f10-us1-ask.spec.ts` (story 1, scenarios 1–5):
  - In an empty project, type and send. An origin bubble and an answer are visible, and `[data-testid=streaming]`
    shows progressive text and Stop.
  - Follow-up from the answer composer.
  - A second send from the same answer fans right.
  - `__farabiCamera().mode === "follow"` and the target is in view within 1 s.
  - Offline: the error shows with Retry, and the draft is kept.

### Implementation

- [X] T039 [US1] Create `src/server/graph/ask.ts`:
  - `startTree(projectId, content)` allocates the tree origin as `createRootTree` does in
    `src/server/forest/trees.ts`, inserts the tree, the origin edge (sent at insert) and a pending
    answer in one transaction, then starts generation after commit.
  - `ask(elementId, content)`:
    - from an answer, or from a sent edge whose newest attempt isn't pending
    - refused with `reply_in_progress` while the element's own newest attempt is pending
    - refused with `not_askable` for an output or an unsent edge
    - inserts the edge (`origin: "ask"`) and a pending answer, then starts generation
    - `????` is delegated to `tryQuickBranch` (T055), falling back to an ordinary ask
- [X] T040 [US1] Add the routes `src/app/api/trees/route.ts` (POST) and
  `src/app/api/nodes/[nodeId]/ask/route.ts`. Both support `?wait=1` as today.
- [X] T041 [US1] Add `src/app/api/answers/[answerId]/stop/route.ts` and
  `src/app/api/answers/[answerId]/stream/route.ts`, ported from `src/app/api/messages/[messageId]/{stop,stream}`
  with the same SSE events `snapshot`, `delta` and `end`.
- [X] T042 [US1] Create `src/canvas/overlays/Composer.tsx` from `src/components/chat/Composer.tsx`
  (canvas-ui.md "Composer"):
  - **Position**: a screen-space overlay pinned below `renderer.elementScreenRect(focusId)`, docked
    to the viewport edge with `data-docked="true"` when the element is off-screen.
  - **Placeholders** by target.
  - **Drafts**: per target in `store.drafts`. A draft is cleared only after the server stored the
    message (FR-015).
  - **Stop** shows while the target's newest answer is pending.
  - **`????`**: sends instantly when the target is an answer with a re-askable edge.
  - **Calls**: `api.startTree` when there is no focus or tree, and `api.ask` otherwise. Then merge
    the results, focus the new answer and call `camera.follow` (FR-010, FR-025).
  - **Pinning**: pins its target in `TextLayer` while the draft is non-empty (FR-034).
- [X] T043 [US1] Wire streaming in `src/canvas/CanvasHost.tsx`:
  - For each pending answer in the store, subscribe with `useReplyStream`.
  - Feed text to `TextLayer` (re-parse at most every 100 ms) and `heights` (updates at most every
    100 ms).
  - Relayout only that tree, and pin the answer while it streams.
  - On `end`, merge the final answer and unpin.
- [X] T044 [US1] Answer frame states in `src/canvas/renderer/CanvasRenderer.ts`:
  - pending header dots
  - incomplete or stopped footer with Retry
  - failed stub with Retry, wired to `api.attempts(edgeId, "retry")` (the service comes in US7,
    T088, and is stubbed to 409 until then)
  - the AI tag on answers and outputs (FR-060)
- [X] T045 [US1] Create `src/canvas/overlays/EmptyState.tsx`, "Ask anything to start a tree", with
  the composer targeting a new tree. Add a "New tree" entry to the canvas menu that sets the
  composer target to a new tree.
- [X] T046 [US1] Add canvas styles in `src/app/globals.css`:
  - text layer and items (answer markdown typography from Feature 7)
  - question bubble colours
  - composer overlay with the rounded input and icon Send and Stop (Feature 7)
  - fade on clipped text
  - docked composer pointer

  Remove the `.chat`, `.message-list`, map-overlay and inherited-context rules.

**Checkpoint**: Story 1 works end to end on a new project (quickstart §3.1).

---

## Phase 4: User Story 2 — Read and select text at any zoom (P1)

**Goal**: Real, selectable, clipped text at every zoom, with the Define, Branch and Park toolbar,
markers, terms and suggestions on mounted text.

**Independent test**: Select a phrase at the furthest and the closest zoom and see the toolbar.
Text outside the viewport is not mounted (quickstart §3.2).

### Tests (write first)

- [X] T047 [P] [US2] Unit tests in `tests/unit/f10-selection.test.ts`. Adapt `tests/unit/selection.test.ts`:
  - `selectionToAnchor` on `[data-node-id]` roots returns `{ nodeId, start, end, text, prefix, suffix }`
  - a cross-element selection → null
  - a selection ending at a clipped item's last mounted span maps to the visible portion only
    (FR-033)

  Delete `tests/unit/selection.test.ts` once merged.
- [X] T048 [P] [US2] E2E `tests/e2e/f10-us2-zoom-select.spec.ts` (story 2, scenarios 1–5; SC-004,
  SC-006, SC-007):
  - at 6 zoom levels from 0.02 to 4, selecting in a visible item opens the toolbar
  - `data-clipped` at far zoom, with the mounted characters growing on zoom in
  - `offscreenMounted === 0` after idle
  - a selection and a composer draft survive panning away and back
  - `__farabiCanvasDrift() <= 1`
  - a marker span, a term underline and a suggestion underline render, and a selection across
    them works

### Implementation

- [X] T049 [US2] Update `src/components/chat/selection.ts`: the root attribute becomes
  `data-node-id`, the result type returns `nodeId` instead of `messageId`, and `rangeForOffsets`
  takes the item element. Move it to `src/canvas/text/selection.ts` and update imports.
- [X] T050 [US2] Create `src/canvas/text/render.ts`, which renders `RichText` runs into an item:
  - split runs at boundaries from `markerRanges.splitByMarkers` (moved to
    `src/canvas/text/markerRanges.ts`)
  - markers come from child edges' anchors on this element (`data-markers`)
  - terms come from `definitionsStore.matcher` (`term-mark`, `data-def-id`)
  - suggestions apply only to complete answers when suggestions are on (Feature 5, FR-056)
  - question edges and outputs render plain text (`white-space: pre-wrap`), with the same span
    contract

  Re-render an item only when its markers, terms or the suggestion setting change.
- [X] T051 [US2] In `src/canvas/text/TextLayer.ts`:
  - pin on `selectionchange` while the selection is inside an item, and unpin when it leaves
  - re-mount and refresh items whose budget grew past their clip point on zoom-in (story 2,
    scenario 2)
  - after a full mount, measure `offsetHeight` and call `heights.recordMeasured`, relaying out the
    tree when it changed by more than 2 px
- [X] T052 [US2] Create `src/canvas/overlays/SelectionToolbar.tsx` from
  `src/components/chat/BranchAction.tsx`:
  - It watches `selectionchange` within the text layer and shows Define, Branch and Park above the
    selection, with the inline question step of Feature 8.
  - **Define** calls `api.captureDefinition({ nodeId, start, end, text })`.
  - **Branch** and **Park** are wired in US3 (T057, T061).
  - **Hidden** for a cross-element selection, and for Branch and Park on outputs (Define only).
- [X] T053 [US2] Marker and term interactions in `src/canvas/CanvasHost.tsx`:
  - a click on `[data-markers]` walks to the edge (`focus` and `camera.follow`), or opens
    `src/canvas/overlays/MarkerMenu.tsx` when there are several
  - a click on `[data-suggest]` selects that range, as in `ChatView.onListClick`
  - mount `TermCard` over the text layer

**Checkpoint**: Selection works at every zoom, and only visible or pinned text is mounted.

---

## Phase 5: User Story 3 — Branch from anywhere (P1)

**Goal**: Branch from a span in an answer or a question edge, send an unsent branch, re-ask with
`????`, park and fire tangents, and see children in the side panel.

**Independent test**: Each of the four gestures produces the right edge, source and marker
(quickstart §3.3).

### Tests (write first)

- [X] T054 [P] [US3] Integration tests in `tests/integration/f10-graph.test.ts` (branching part):
  - **Branch from an answer span**: an unsent edge with the anchor and computed prefix and suffix,
    no AI call.
  - **Branch from a question-edge span**: the parent is the edge.
  - **Validation**: invalid spans → 400 `invalid_selection`; from a pending answer → 409
    `not_branchable`.
  - **Sending** an unsent edge sets text and `sent_at` once, and a second send → 409
    `already_sent`.
  - **`????` from an answer**: a sibling edge from the source of its edge with the same text and
    `requery_of` set, the reply starts, and `????` never reaches the provider (check fake calls).
  - **Second `????`** for the same edge → an ordinary message.
  - **`????` on an origin-edge answer** → an ordinary message.
  - **Context**: the quick-branch context excludes the re-asked edge (FR-020).
  - **Overlapping markers** on one element: several branches with no limit (FR-019).
- [X] T055 [P] [US3] Adapt `tests/integration/f8-parked.test.ts` to v2:
  - park on an answer span and on an edge span
  - question edit, discard, fire with a question (auto send) and fire without one (preload draft
    with the anchor text)
  - a fired tangent can't fire twice
  - parking never changes elements
- [X] T056 [P] [US3] E2E `tests/e2e/f10-us3-branch.spec.ts` (story 3, scenarios 1–5):
  - the four gestures
  - the marker click walks the camera to the edge (FR-018)
  - the side panel lists the direct child edges, newest first (FR-022)

### Implementation

- [X] T057 [US3] Create `src/server/graph/branch.ts` from `src/server/forest/branch.ts`.
  `validateSpan(trx, elementId, span)`:
  - **Allowed**: a sent question edge, or an answer with `status = 'complete'`.
  - **Checks**: `0 <= start < end <= length(text)`, `text.slice(start, end) === span.text`, and
    the text is not blank.
  - **Refused** for function outputs.

  `insertBranchEdge(trx, parent, span, origin: "branch"|"parked")` sets the anchor with 32
  characters of prefix and suffix. Add `src/app/api/nodes/[nodeId]/branches/route.ts` (FR-017). The
  AI is never called.
- [X] T058 [US3] Create `src/server/graph/sendUnsent.ts` (or a function in `ask.ts`):
  `sendUnsent(edgeId, content)` sets `text` and `sent_at` through the guard's send path, inserts a
  pending answer and starts generation. A second send → 409 `already_sent`. Add
  `src/app/api/edges/[edgeId]/send/route.ts`.
- [X] T059 [US3] Create `src/server/graph/quickBranch.ts` from `src/server/messages/quickBranch.ts`.
  `tryQuickBranch(answerId)` returns null unless all of these hold:
  - the focused element is an answer
  - its edge is a `question` with `parent_id` not null
  - no element has `requery_of` = that edge

  Otherwise it inserts a sibling edge under the edge's parent with the same text,
  `origin: "quick_branch"` and `requery_of`, sent at insert, plus a pending answer, then starts
  generation. Return `{ kind: "quick_branch", edge, answer }`.
- [X] T060 [US3] Re-target `src/server/parked/{park,fire,state}.ts` to v2:
  - the anchor is validated with `validateSpan` on any element
  - `fire` uses `insertBranchEdge(…, "parked")`, plus a sent edge and a pending answer when there
    is a question
  - the `fired` event records `edge_id`

  Update `src/app/api/nodes/[nodeId]/parked/route.ts` and `src/app/api/parked/[id]/{question,discard,fire}/route.ts`.
- [X] T061 [US3] Wire Branch and Park in `src/canvas/overlays/SelectionToolbar.tsx`:
  - **Branch** calls `api.branch`, merges the unsent edge, focuses it, preloads the draft (the
    inline question, else the anchor text) and calls `camera.follow`.
  - **Park** calls `api.park`, refreshes the panel and shows the parked notice (Feature 8).
- [X] T062 [US3] Unsent edges in `src/canvas/renderer/CanvasRenderer.ts` and
  `src/canvas/overlays/Composer.tsx`:
  - draw a dashed empty bubble
  - the composer targets the edge with the placeholder "Ask about the highlighted text…" and sends
    through `api.sendUnsent`
  - draw the marker connector stub from the span's position
- [X] T063 [US3] Create `src/server/graph/panel.ts` and `src/app/api/nodes/[nodeId]/panel/route.ts`
  returning `{ children, parked }` (FR-022). Create `src/canvas/overlays/SidePanel.tsx` from
  `src/components/chat/BranchPanel.tsx`: the Branches tab lists child edges with their state and
  first words or anchor, and a click walks there. The Parked tab is unchanged.
- [X] T064 [US3] Path emphasis on focus in `src/canvas/CanvasHost.tsx`. Pass
  `graph.ancestors(focusId)` to the renderer's path emphasis (FR-026) and to `__farabiCanvasDebug`
  (`onPath`).

**Checkpoint**: All branching gestures work on the canvas.

---

## Phase 6: User Story 4 — Existing work survives the move (P1)

**Goal**: Convert all v1 data losslessly, verify it, and keep the originals untouched.

**Independent test**: On a fixture, and on a restored copy of the owner's data, `v1:verify`
passes every invariant, and a rerun inserts 0 rows (quickstart §1).

### Tests (write first)

- [X] T065 [P] [US4] Integration test `tests/integration/v1-convert.test.ts`:
  - Seed the fixture listed in contracts/migration.md "Fixture coverage" through `seedV1`.
  - Run `convertV1` in a transaction.
  - Assert every row of the conversion rules table: parent, origin, anchor, `requery_of`, status,
    times and ids.
  - Assert the five invariants: text reproduction, unchanged reply context, counts, checksums
    equal, rerun inserts 0.

### Implementation

- [X] T066 [US4] Implement `convertV1` in `src/server/db/v1/convert.ts` following
  contracts/migration.md "Conversion rules". All inserts use `ON CONFLICT DO NOTHING`, and every
  rule appends to `v1_conversion`.
  1. **Trees**: copy each tree with the same id, project, origin and `user_placed`.
  2. **Messages**: walk each v1 conversation's messages in `seq` order, including replaced ones.
     - **First user message**:
       - root conversation → origin edge
       - selection marker → branch edge (origin `parked` if a `fired` event names the
         conversation), with the parent = the marker's message id and the anchor copied
       - whole-message marker → quick-branch edge, with the parent = the re-asked edge's v2 parent
         and `requery_of` set
     - **Later user messages**: the parent is the newest *complete* answer after the previous user
       message, else the previous edge.
     - **AI messages**: become answers under the preceding user message's edge. The origin is
       `reply`, `retry` or `regenerate` by the replaced row's status.
     - **Copied fields**: `text`/`content`, status, `partial_content`, pressure, model,
       `created_at`, and `sent_at` = the message's `created_at`.
  3. **Empty branch conversations** → unsent edges with the v1 node id.

  Derived ids are `md5('<table>:<id>:<n>')::uuid`.
- [X] T067 [US4] Extend `convertV1` with the remaining rules (contracts/migration.md):
  - **Edge labels** → `edge_notes` on the conversation's first edge, in order.
  - **Parked tangents** → `parked_tangents` on the element with the tangent's `message_id`, plus
    their events (`fired` → that conversation's first edge).
  - **Function outputs**: pipes and pipe nodes → function edges under the answer at the source
    summary's `through_message_id`; output versions → one analogy output each; output events →
    `output_reviews`.
  - **Kind settings**: kind-level rows as they are; output overrides → the function edge.
  - **Conversation hand placements** → ledger only (`detail.manual`, `v2_id` NULL; research R4,
    open decision). 009 output placements → `manual_x/y`.
  - **Report**: return a `ConversionReport` of counts per rule.
- [X] T068 [US4] Backfills in `src/server/db/migrations/0010_message_graph.ts` after `convertV1`:
  - `UPDATE definitions SET source_id = source_message_id WHERE source_id IS NULL`
  - `feedback_items.element_id` = the first edge of `node_id`'s conversation through the ledger,
    and `project_id` from its tree
  - replace `feedback_items_rank_only()` to also freeze `project_id` and `element_id`
  - print the report with `console.log`

  Remove the "not implemented" throw from T013.
- [X] T069 [US4] Create `src/server/db/v1/verify.ts` with the five invariants of
  contracts/migration.md, each returning `{ name, ok, details }`. Add `scripts/v1-verify.ts`, which
  prints them and exits 1 on failure, and `scripts/v1-convert.ts`, which reruns `convertV1` in a
  transaction and prints "N new rows".
- [X] T070 [US4] Backup step in `scripts/migrate.ts`. When `0010_message_graph` is pending and
  `public.messages` exists with rows:
  1. Run `docker compose exec -T db pg_dump -Fc -U farabi farabi` into
     `db/backups/<ISO time>-pre-0010.dump`.
  2. Check that the file size is > 0.
  3. Refuse to migrate on failure unless `--no-backup` is given (research R3; FR-063).

  Skip it for `--test`.
- [X] T071 [US4] Create `src/app/n/[nodeId]/page.tsx` as a redirect. Look the id up in
  `v1_conversion`: a v1 conversation id → its first edge, and an element id → itself. Then
  `redirect("/?focus=<id>")`. Unknown → `notFound()`. Rewrite `src/app/map/page.tsx` to
  `redirect("/")` (research R18). Reading `v1_conversion` is allowed. It isn't the `v1` schema.
- [X] T072 [US4] Focus from the URL in `src/canvas/CanvasHost.tsx`: on load with `?focus=` (and
  optional `&span=start-end`), focus that element, walk the camera there, and select the span once
  mounted (FR-055 link target).
- [X] T073 [US4] E2E `tests/e2e/f10-us4-migration.spec.ts`:
  1. Seed a small v1 fixture through a test-only route `src/app/api/test/convert-v1/route.ts`
     (`FARABI_TEST_HOOKS` only). It seeds the fixture and runs `convertV1`.
  2. Open the canvas: the converted conversation's text is visible as a column, the branch marker
     is present, and the definition underline renders.
  3. `/n/<v1 conversation id>` lands focused on its first edge.

**Checkpoint**: The migration is proven on fixtures. Before Phase 9, restore a copy of the owner's
database and run quickstart §1 against it.

---

## Phase 7: User Story 5 — Move around a big map (P2)

**Goal**: Walking moves the camera and manual moves free it, with a minimap and a camera that
persists per project, at 5,000 elements.

**Independent test**: Story 5's independent test and SC-005, SC-008 and SC-012 (quickstart §3.4,
`f10-scale`).

### Tests (write first)

- [X] T074 [P] [US5] E2E `tests/e2e/f10-us5-camera.spec.ts`:
  - `Alt+↑`, `Alt+↓`, `Alt+←` and `Alt+→` walk, and the camera follows within 1 s
  - a wheel pan → `mode: "free"`, and a reply finishing elsewhere and another tree growing cause 0
    automatic moves
  - minimap click and drag move the camera within 100 ms and the rectangle matches
    (`__farabiMinimap`)
  - the minimap can be hidden
  - reload restores the camera
- [X] T075 [P] [US5] E2E `tests/e2e/f10-scale.spec.ts`:
  - `npm run seed:large -- --test --elements 5000`
  - the canvas opens in < 1 s
  - pan p95 < 16.7 ms and zoom-step p95 < 20 ms
  - minimap response < 100 ms
  - `offscreenMounted === 0`

### Implementation

- [X] T076 [US5] Create `src/canvas/renderer/minimap.ts`:
  - a fixed 220×160 screen-space container in the same Pixi app (bottom-right)
  - each element drawn as a 1–2 px point coloured by tree, a faint region per tree and the
    viewport rectangle
  - redrawn on layout change, with the rectangle updated on camera change
  - click centres the camera and drag moves it continuously, with `camera.onManual()`
  - toggle `[data-testid=minimap-toggle]` persisted to `store.minimapHidden`
  - the test hook `__farabiMinimap()`
- [X] T077 [US5] Camera persistence:
  - `src/server/graph/camera.ts` and `src/app/api/projects/[id]/camera/route.ts` (PUT,
    `scale CHECK 0.02..4`)
  - `CanvasHost` saves after 500 ms of camera idle, and restores from `GET /api/canvas` `camera` on
    open (or fits the project bounds when there is none) (FR-028)
- [X] T078 [US5] Keyboard walks in `src/canvas/input.ts` through `graph.ts`:
  - `Alt+↑` → parent
  - `Alt+↓` → first child
  - `Alt+←` and `Alt+→` → previous or next sibling by `createdAt`

  Each walk sets focus and calls `camera.follow`. Side panel entries and definition links use the
  same walk function.
- [X] T079 [US5] Rewrite `scripts/seed-large.ts`. `--elements N` (default 5,000) seeds one project
  of 20 trees:
  - edge and answer chains, with about 15% of elements branching
  - answer texts drawn from the same length distribution as T009
  - `--test` targets the test database
  - it keeps `--feedback N`
  - drop `--outputs`, or re-target it to create function edges and outputs on answers

**Checkpoint**: A big map is navigable, and the scale spec passes.

---

## Phase 8: User Story 6 — Rearrange by hand and keep notes on edges (P2)

**Goal**: Drag elements and trees, add, edit and clear edge notes. All of it persists without
changing structure.

**Independent test**: Drag a tree and one element, add a note, reload: all persist and no
connection changed (quickstart §3.5).

### Tests (write first)

- [X] T080 [P] [US6] Integration tests in `tests/integration/f10-arrange.test.ts`, adapting
  `tests/integration/f2-us3-positions.test.ts` and `f2-us5-edge-labels.test.ts`:
  - a position update changes only `manual_x/y`
  - the origin edge → 409 `origin_edge`
  - tree origin → `user_placed`
  - note set, change and clear append versions
  - a note longer than 200 characters → 400
  - a note on an answer → 409 `not_an_edge`
  - no update can change `parent_id` (guard)
- [X] T081 [P] [US6] E2E `tests/e2e/f10-us6-arrange.spec.ts` (story 6, scenarios 1–5):
  - frame drag moves one element, and Alt-drag or the origin handle moves the tree
  - reload keeps positions
  - adding an answer in another tree leaves these unchanged
  - note add, edit and clear
  - a click focuses and a drag past 4 px doesn't

### Implementation

- [X] T082 [US6] Create `src/server/graph/positions.ts` and
  `src/app/api/nodes/[nodeId]/position/route.ts`: PUT `{ x, y }` relative to the tree origin,
  refused for an origin edge with 409 `origin_edge`. Port `src/app/api/trees/[treeId]/origin/route.ts`
  to the v2 `trees` table, which sets `user_placed` (FR-037, FR-038).
- [X] T083 [US6] Create `src/server/graph/notes.ts` and `src/app/api/edges/[edgeId]/note/route.ts`:
  - PUT `{ text: string | null }`
  - trim and collapse whitespace
  - empty → NULL
  - `length 1..200` else 400
  - insert an `edge_notes` row `user_authored`
  - not an edge → 409 `not_an_edge` (FR-040)
- [X] T084 [US6] Dragging in `src/canvas/renderer/CanvasRenderer.ts` and
  `src/canvas/CanvasHost.tsx`:
  - frame drag moves the element live and writes once on release
  - Alt-drag, or dragging the origin handle, moves the tree
  - relayout keeps other trees fixed
  - store and render optimistically, and roll back with an error on failure
- [X] T085 [US6] Create `src/canvas/overlays/NoteEditor.tsx` from `src/components/map/EdgeLabelEditor.tsx`.
  It opens from a note chip on a question edge's connector. The renderer draws the chip as a frame
  only, and the note text is a text-layer item for the edge note (FR-030).

**Checkpoint**: Hand arrangement and notes work and persist.

---

## Phase 9: User Story 7 — Retry without losing anything (P2)

**Goal**: Retry and regenerate add sibling answers, and earlier attempts and their branches stay.

**Independent test**: Branch from an answer, regenerate it: a sibling appears and the original and
its branch remain unedited (quickstart §3.6).

### Tests (write first)

- [X] T086 [P] [US7] Integration tests in `tests/integration/f10-graph.test.ts` (attempts part):
  - retry after stopped, incomplete or failed → a new sibling answer, and the old row is unchanged
  - retry when the newest is complete → 409 `not_retryable`
  - regenerate with a complete attempt → a sibling, allowed when that answer has a branch, and the
    branch's parent is still the original (FR-041, FR-042, SC-011)
  - regenerate with no complete attempt → 409 `not_regenerable`
- [ ] T087 [P] [US7] E2E `tests/e2e/f10-us7-attempts.spec.ts` (story 7, scenarios 1–3).

### Implementation

- [X] T088 [US7] Create `src/server/graph/attempts.ts` and
  `src/app/api/edges/[edgeId]/attempts/route.ts`. POST `{ mode }`:
  - **`retry`**: the newest attempt must be `incomplete`, `stopped` or `failed`.
  - **`regenerate`**: some attempt must be `complete`.

  Each inserts a pending answer with `origin` `retry` or `regenerate` under the same edge, and
  never touches earlier attempts. Generation starts after commit.
- [ ] T089 [US7] UI in `src/canvas/renderer/CanvasRenderer.ts` and `src/canvas/CanvasHost.tsx`:
  - Retry on incomplete, stopped and failed frames, and Regenerate in a complete answer's frame
    header
  - after the call, focus the new attempt and call `camera.follow`
  - attempts are laid out as siblings to the right (T028), with "Attempt n of m" in the frame
    header (an overlay chip)

**Checkpoint**: Attempts are additive and visible side by side.

---

## Phase 10: User Story 9 — Everything else keeps working (P2)

**Goal**: Definitions, suggested underlines, feedback, projects, the Parked tab and reply settings
work on the canvas.

**Independent test**: Each carried-over feature behaves as its own spec says (quickstart §3.8,
SC-016).

### Tests (write first)

- [X] T090 [P] [US9] Adapt `tests/integration/f2-us4-definitions.test.ts`:
  - capture from an answer span and from a question-edge span sets `source_id`
  - a duplicate term → the existing entry (FR-055)
  - the source link is `{ elementId, excerpt }`
  - pending, failed or unsent sources → 409
- [X] T091 [P] [US9] Adapt `tests/integration/f3-*.test.ts`:
  - feedback with `view: "canvas"`, `projectId` and `elementId`
  - a legacy item keeps `view` and `node_id` and gets `element_id`
  - `project_id` and `element_id` can't change after insert (trigger)
  - the export file prints the element kind and an excerpt
- [X] T092 [P] [US9] Adapt `tests/integration/f4-projects.test.ts` and `f6-settings.test.ts`:
  - the canvas loads only the open project's trees
  - trashed projects are hidden
  - a reply streaming in project A finishes and is stored while B is open (FR-012)
  - each answer records the pressure and model in effect at insert (FR-057)
- [X] T093 [P] [US9] E2E `tests/e2e/f10-us9-carried.spec.ts`:
  - term underline and hover card on mounted text
  - suggestion underline on complete answers only, where a click selects
  - feedback while focused records the element
  - project switch shows that canvas while the other project's reply completes

  Adapt `tests/e2e/f3-*.spec.ts`, `f4-projects.spec.ts` and `f6-settings.spec.ts` to the canvas.

### Implementation

- [X] T094 [US9] Re-target `src/server/definitions/capture.ts` and `src/server/definitions/list.ts`:
  - capture validates with `validateSpan`, extended to accept outputs for Define only, and sets
    `source_id`
  - the project comes from the element
  - list returns `source: { elementId, kind, excerpt, projectId }`, using `source_id` (or the
    backfilled one)
  - the draft input uses the source element's text and the path's text, never more (Feature 2,
    FR-029)

  Update `src/components/definitions/DefinitionsList.tsx` links to
  `/?focus=<elementId>&span=<start>-<end>`.
- [X] T095 [US9] Feedback context:
  - `src/lib/feedbackContext.ts` returns `{ view: "canvas", projectId, elementId }` from the canvas
    store
  - `src/server/feedback/create.ts` validates `elementId` exists in the project
  - `src/server/feedback/exportFile.ts` prints the kind and a 120-character excerpt (FR-058)
- [X] T096 [US9] Projects: `src/components/common/ProjectMenu.tsx` switches project and remounts
  `CanvasHost` with the new `projectId`. Generation keeps running server-side (FR-012). Confirm that
  trash and restore routes need no change (FR-059).
- [X] T097 [US9] Suggestions toggle: move the "Suggestions" control from `NodeHeader` into the
  canvas menu (`src/canvas/CanvasHost.tsx`), persisted in `settingsStore.showSuggestions`.
  `render.ts` applies it to complete answers only (FR-056).

**Checkpoint**: All carried-over suites pass on the graph (SC-016).

---

## Phase 11: User Story 8 — Run a function on a node (P3)

**Goal**: Analogy on an answer creates a function edge and an output. Confirm, reject, run again,
and kind settings with per-edge overrides.

**Independent test**: Story 8's independent test, plus SC-013 (quickstart §3.7).

### Tests (write first)

- [X] T098 [P] [US8] Unit tests in `tests/unit/f10-registries.test.ts`, adapting
  `tests/unit/f9-registries.test.ts`:
  - shape and display consistency is enforced
  - a function whose `outputKind` isn't shape `node`, or doesn't accept its inputs, is refused
  - registering a test kind and a test function needs no runner change (SC-013)
- [X] T099 [P] [US8] Integration tests in `tests/integration/f10-functions.test.ts`, adapting
  `f9-functions.test.ts`:
  - **Menu** lists only accepting functions.
  - **Run** creates a function edge (parent = answer) and an output (parent = edge), both
    `ai_suggested`, with `function_id` and `version`.
  - **Failure**: fake failure → 503 and 0 rows written (FR-052).
  - **Rerun** adds a sibling output under the same edge, and the confirmed one stays confirmed.
  - **Reviews**: confirm → `output_reviews` `user_confirmed`; reject → hidden by the derived review.
  - **Wrong kind** → 409.
  - **SC-013**: register `restate` and `summary_card` in the test and run them through the route.
  - **No AI on load**: `GET /api/canvas` makes 0 provider calls (SC-014).
- [X] T100 [P] [US8] Adapt `tests/integration/f9-settings.test.ts` to
  `tests/integration/f10-settings.test.ts`:
  - kind-level set and override on a function edge
  - resolution is edge, then kind, then default
  - a change never starts a run
  - every change is recorded with its time (FR-053)
- [ ] T101 [P] [US8] E2E `tests/e2e/f10-us8-functions.spec.ts` (story 8, scenarios 1–5).

### Implementation

- [X] T102 [US8] Update `src/server/functions/definitions/{types,analogy}.ts` (contracts/declarations.md):
  - `reads: "text"`, `edgeKind: "function"`
  - Analogy `version: 2` and `accepts: ["answer"]`
  - instruction text per the declarations contract, with the no-new-claims rule kept

  Registration checks that `outputKind` has shape `node` and accepts the inputs.
- [X] T103 [US8] Rewrite `src/server/functions/runner.ts` (contracts/declarations.md "Runner"):
  - `runFunction` loads the live input, checks kind, resolves settings at kind level, reads its
    text, calls `provider.complete`, then inserts the function edge and output in one
    transaction.
  - `rerunFunction(edgeId)` resolves with the edge override and inserts one output.
  - Failures write nothing.

  Delete `src/server/functions/{state,readers,views}.ts`. A `text` reader stays inline as the input
  row's `text`.
- [X] T104 [US8] Create `src/server/functions/review.ts`: `confirm(outputId)` appends `confirmed`
  `user_confirmed`, and `reject(outputId)` appends `rejected` `user_authored`. Only outputs are
  accepted (`origin = 'run'`, shape node), otherwise 409 `wrong_kind`.
- [X] T105 [US8] Update `src/server/settings/kindSettings.ts`: overrides are keyed by a function
  edge id, and resolution is the edge override, then the kind value, then the default.
- [X] T106 [US8] Add these routes per contracts/http-api.md:
  - `src/app/api/nodes/[nodeId]/functions/route.ts` (GET)
  - `src/app/api/nodes/[nodeId]/functions/[functionId]/run/route.ts`
  - `src/app/api/edges/[edgeId]/rerun/route.ts`
  - `src/app/api/nodes/[nodeId]/{confirm,reject}/route.ts`
  - `src/app/api/edges/[edgeId]/settings/route.ts`

  Update `src/app/api/kind-settings/route.ts`.
- [ ] T107 [US8] Function UI:
  - `src/canvas/overlays/FunctionMenu.tsx`, from `src/components/kinds/FunctionMenu.tsx`, opens
    from `ƒ` in an answer's frame.
  - `src/canvas/overlays/OutputActions.tsx` has Confirm, Reject and Run again on output frames,
    plus a working state and an error with Retry.
  - Draw function connectors in `CanvasRenderer`: directional, dashed while proposed, solid when
    confirmed (FR-049).
  - The edge chip has a Settings popover from `src/components/kinds/NodeSettings.tsx`.
  - "Show rejected" in the canvas menu.
  - Function output arrival never moves the camera (FR-025).
- [ ] T108 [US8] Update `src/components/settings/KindSettingsSections.tsx` to render sections for
  every kind that declares settings (FR-053). No other change is expected.

**Checkpoint**: Functions work on edges, and SC-013 holds.

---

## Phase 12: Polish and cross-cutting

- [ ] T109 Remove dead code (plan "Removed"):
  - `src/components/chat/{ChatView,NodeHeader,InheritedContext,Message,rehypeSourceOffsets,TermText}.tsx`
    (keep `Composer` only if still imported)
  - `src/components/map/*` and `src/map/*`
  - `src/components/kinds/{OutputView,PipeView,PipeCard,views,NodeSettings}.tsx`
  - `src/components/common/{ViewToggle,NewConversationButton}.tsx`
  - `src/server/{forest,summaries,messages}/*` and `src/server/nodes/kinds.ts`
  - `src/lib/nodeCache.ts`
  - the API routes listed as removed in contracts/http-api.md

  Drop `d3-hierarchy` and `react-markdown` from `package.json` if nothing imports them.
- [ ] T110 [P] Retire the chat- and map-only suites that the f10 suites replace:
  - `tests/e2e/{us1-root,us2-branch,us3-map,us4-roundtrip,us5-drift,scale,f2-us1-streaming,f2-us2-quick-branch,f2-us3-drag,f2-us5-edge-labels,f5-suggestions,f7-chat-visual,f8-branch-queue,f9-node-functions,f9-scale,feedback-round-1,regenerate-offline}.spec.ts`
  - `tests/integration/{us1-conversations,us2-branching,us3-forest,us5-summaries,f2-us1-streaming,f2-us2-quick-branch,f2-us3-positions,f2-us5-edge-labels,f9-functions,f9-settings}.test.ts`
  - `tests/unit/{layout,stack,f2-layout-manual,f9-satellites,f9-output-state,f9-kind-settings-ui}.test.ts`

  Before deleting each one, check that its behaviour is covered by an f10 test or is intentionally
  gone.
- [ ] T111 [P] Delete the spike `src/app/dev/canvas-spike/page.tsx` and
  `tests/e2e/f10-m0-spike.spec.ts`, keeping the numbers in research R17. `f10-scale` now guards
  performance.
- [ ] T112 [P] Update `README.md` "Using it" for the canvas:
  - ask, branch, `????` and park
  - pan with the wheel, Ctrl/Cmd+wheel to zoom, Alt+arrows to walk
  - drag a frame, Alt-drag a tree
  - minimap
  - functions
  - migration and backup (`npm run db:migrate`, `v1:verify`)
- [ ] T113 [P] Add a note at the top of `specs/009-node-function-foundation/spec.md` saying it was
  superseded by `specs/010-v02-message-graph-canvas/` (spec assumption "Feature 009 is folded in").
- [ ] T114 Run `npm run typecheck`, `npm run lint`, `npm test` and `npx playwright test`, and fix
  failures.
- [ ] T115 **Owner step**: run quickstart §1 on the owner's real database (backup, migrate,
  `v1:verify`, rerun `v1:convert`) and then §3. Report the counts. Do not run this without the
  owner's go-ahead.

---

## Dependencies and execution order

### Phase dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)**. Inside Phase 2, the M0 gate (T004–T011) comes
  first. T012–T036 follow, and T012 → T013 → T014 come before the server core.
- **US1 (Phase 3)** depends on Phase 2. It is the MVP.
- **US2 (Phase 4)** depends on US1, because there must be text on the canvas to select.
- **US3 (Phase 5)** depends on US2 (the toolbar and markers).
- **US4 (Phase 6)** needs Phase 2 only for the converter and verify work (T065–T070), which can run
  in parallel with US1 to US3. T071–T073 need US1 (the canvas) to show results.
- **US5, US6 and US7 (Phases 7–9)** depend on US1. They are independent of each other.
- **US9 (Phase 10)** depends on US2 (Define and terms) and US3 (parked).
- **US8 (Phase 11)** depends on US1. It is independent of US5 to US7.
- **Polish (Phase 12)** comes after every story. T115 needs US4 plus the owner's go-ahead.

### Within each story

Tests first (they fail), then server services, then routes, then client wiring.

### Parallel opportunities

- **Phase 2**:
  - T004, T005, T006 and T007 in parallel
  - T015 and T016 in parallel, after T014
  - T025, T026 and T027 in parallel
  - T029 and T032 in parallel with their implementations' neighbours
- **Across stories**: US4's converter (T065–T070) can run alongside US1 to US3. After US1, US5, US6,
  US7 and US8 can run in parallel.
- **Test tasks** marked [P] in each story can be written together.

## Parallel example: User Story 4 alongside User Story 1

```text
Developer A: T037 → T038 → T039 … T046   (US1 ask loop)
Developer B: T065 → T066 → T067 → T068 → T069 → T070   (US4 converter, verify, backup)
```

## Parallel example: User Story 3 tests

```text
Task: "T054 Integration tests in tests/integration/f10-graph.test.ts (branching part)"
Task: "T055 Adapt tests/integration/f8-parked.test.ts to v2"
Task: "T056 E2E tests/e2e/f10-us3-branch.spec.ts"
```

## Implementation strategy

### MVP first

1. Phase 1, then Phase 2 with the **M0 gate**. Stop and report the numbers.
2. Phase 3 (US1): a new project supports the ask loop on the canvas. Demo it.
3. Phases 4 and 5 (US2, US3): selection at any zoom and every branching gesture. This is the full
   P1 product on new data.
4. Phase 6 (US4): the converter is proven on fixtures, then on a restored copy of real data.

### Incremental delivery after the MVP

US5 (big map), then US6 (arrange and notes), then US7 (attempts), then US9 (carried-over
features), then US8 (functions), then Polish. The owner runs the real migration (T115) last, once
everything is green.

### Notes

- The `v1` schema is read only by `src/server/db/v1/**` and migration 0010, and the guard in T024
  enforces this.
- Never edit `feedback/FEEDBACK.md` or the `feedback_*` rows by hand (CLAUDE.md).
- Commit after each task or logical group, on `v0.2`.
