# Research: Farabi v0.2 — Message Graph and Canvas

Decisions behind [plan.md](./plan.md). Each entry gives the decision, why it was chosen, and what
else was considered. Measurements of the current data come from a read-only count of the owner's
database on 2026-10-01:

- 3 projects (1 trashed), 6 trees (4 hand-placed), 20 conversations (13 hand-placed)
- 67 messages (1 replaced reply), 13 selection markers (3 anchored on user messages), 1 quick branch
- 3 branches with no messages, 6 definitions, 1 parked tangent, 3 edge labels
- 22 feedback items (14 with a node), 23 summaries, 3 Analogy outputs from Feature 009
- longest reply 7,910 characters, average 1,739

## R1. One table for nodes and edges

**Decision**: A single new `nodes` table holds every graph element. Edges are rows whose kind
declares the shape `edge`. Every row has one `parent_id`:

| Row | Its parent |
|-----|------------|
| question edge | the node or edge it leaves (null only for an origin edge) |
| answer node | the question edge that produced it (each attempt is a sibling) |
| function edge | the node it ran on |
| function output | its function edge (each run of that edge is a sibling) |

So a tree is a strictly alternating parent chain. The AI's context is the ancestor chain (R6), a
branch is a second child, and retries and re-runs are sibling children.

**Rationale**: The spec's unified model ("an edge is a special kind of node", FR-001) maps onto one
table directly. Markers, parked tangents, definitions, notes, feedback context and positions all
need to point at "a node or edge", and one table gives them one foreign key. The ancestor path
becomes one recursive query.

**Alternatives considered**:

- Separate `nodes` and `edges` tables. Rejected because every reference (marker source, definition
  source, feedback context, focus) would need two nullable columns. Two user messages in a row, an
  edge sourced from an edge, would also need a self-referencing edge table anyway.
- Extending the Feature 009 `nodes` table in place. Rejected because its rows are whole
  conversations, and converting them in place would modify the original data (FR-063).

## R2. Original data: moved into a frozen `v1` schema

**Decision**: Migration `0010_message_graph` moves the old conversation tables into a Postgres
schema named `v1`. Moving a table changes neither its rows nor its ids, and foreign keys follow the
table. The moved tables are: `trees`, `nodes`, `messages`, `branch_markers`, `node_summaries`,
`edge_label_versions`, `parked_tangents`, `parked_tangent_events`, `pipes`,
`function_output_versions`, `function_output_events` and `kind_setting_changes`.

- Every moved table gets a `BEFORE UPDATE OR DELETE` trigger that raises. Inserts stay possible so
  integration tests can seed v1 fixtures.
- A guard test fails if any file under `src/` other than the converter (`src/server/db/v1/`)
  mentions the `v1` schema.
- Tables that stay live (`projects`, `definitions`, `definition_versions`, `setting_changes` and the
  feedback tables) are changed additively only. New nullable columns are added and backfilled, and
  no existing value is modified.

**Rationale**: FR-063 and SC-003 require the original data to be unchanged and still present.
Moving it out of the app's way makes the freeze enforceable by the database, not just by
convention. It also frees the plain table names for the new model.

**Alternatives considered**:

- Copying everything to backup tables and dropping the originals. Rejected because dropping is
  deletion (Article II).
- Leaving the old tables in `public` under new names. Rejected because it is harder to guard, and
  `v1.messages` says what it is.

## R3. Backup, atomicity and repeatability of the migration

**Decision**:

1. **Backup.** `scripts/migrate.ts` checks whether `0010_message_graph` is pending and the database
   holds v1 data. If so, it takes a backup first with
   `docker compose exec -T db pg_dump -Fc farabi > db/backups/<timestamp>-pre-0010.dump` and checks
   that the file is non-empty. The folder is git-ignored. It refuses to migrate if the backup
   fails, unless `--no-backup` is given; tests use the empty test database and skip this.
2. **Atomicity.** Kysely runs all pending migrations in one transaction on Postgres (checked in
   `kysely/dist/migration/migrator.js`). An interrupted migration therefore leaves the database
   exactly as it was, and running it again starts from scratch (FR-067, story 4 scenario 5).
3. **Repeatability.** The converter is deterministic and idempotent on its own:
   - Each v2 row reuses the id of the v1 row it came from (R4). Rows with no single v1 source get
     ids derived with `uuid_generate_v5`-style hashing (`md5` of a stable key cast to uuid).
   - Every insert is `ON CONFLICT (id) DO NOTHING`.
   - A ledger table, `v1_conversion`, records each v1 row and the v2 row or rows it became.
   - `npm run v1:convert` reruns it safely and reports "0 new rows".
4. **Verification.** `npm run v1:verify` checks the result:
   - It rebuilds every v1 conversation's ordered text from v2 paths and compares text, roles and
     times (SC-001).
   - It counts markers, definitions, parked tangents, notes, positions, feedback links and project
     assignments on both sides (SC-002).
   - It compares the per-table checksums recorded in the ledger at migration start with the
     current v1 tables (SC-003).
5. **Report.** The migration prints counts per kind of v1 row converted (FR-067).

**Rationale**: Atomic plus idempotent covers both "interrupted" and "run again". Reusing ids makes
idempotency trivial and keeps old links meaningful.

**Alternatives considered**:

- A long-running resumable batch job outside migrations. Rejected because the data is 67 messages
  today and in the low thousands later, and one transaction is simpler and safer.

## R4. Conversion rules

**Decision**: The full rules are in [contracts/migration.md](./contracts/migration.md). The key
mappings:

- **Messages.** A user message becomes a question edge with the same id, and an AI message becomes
  an answer node with the same id.
- **First edge of a conversation.**
  - In a root conversation, the first user message becomes the origin edge (parent null).
  - In a branch, the first user message becomes an edge whose parent is the v2 element holding the
    anchor message. That is the message's own id, an answer or a question edge. The edge keeps the
    anchor span.
  - A quick-branch conversation's first edge gets as parent the parent of the re-asked edge, and
    records `requery_of` = the re-asked edge (FR-065).
- **The rest of a conversation.** Walking messages in `seq` order, a user message's parent is the
  latest complete answer since the previous user message. If there is none (an incomplete, stopped
  or failed reply, or no reply), the parent is the previous question edge, which is the spec's "two
  user messages in a row" case. This keeps each reply's context exactly as v1 computed it, since v1
  dropped non-complete replies from context.
- **Replaced replies.** A replaced AI reply (`replaced_at` set) becomes a sibling answer under the
  same edge. The row that replaced it gets `origin = regenerate` if the replaced reply was complete,
  and `retry` otherwise. The live row carries the conversation on.
- **Empty branches.** A branch with no messages becomes an unsent edge (text null) with the v1
  node's id and its anchor.
- **Function outputs.** A 009 output becomes one function output per output version, under a
  function edge with the pipe node's id. The edge's parent is the answer whose id is the
  `through_message_id` of the summary version the analogy was made from. Confirm and reject events
  carry over.
- **Positions.**
  - Tree origins and `user_placed` carry over unchanged.
  - Conversation-level hand placements are kept in the ledger with their v1 coordinates but are not
    applied to the canvas, as the next paragraph explains.

**Rationale for not applying conversation placements**: A v1 position placed a whole conversation
as one 200×64 box. In v2 that conversation is a column of many elements laid out at a different
scale. Pinning only the first element there would detach it from the rest of its column.
Repositioning the whole column would contradict FR-037, where a drag moves only one element. The
coordinates are preserved as data (FR-066, SC-002 "present") and listed by `v1:verify`. **The owner
should confirm this choice.** The alternative is a "placed run" rule, where a placed element
carries its auto-laid run with it.

**Alternatives considered**:

- Scaling v1 coordinates into v2 space. Rejected because element sizes depend on text length, so no
  single factor is right.
- Sourcing the edge after an incomplete reply from that incomplete answer. Rejected because it
  would change what context the next reply was written with.

## R5. Edge state is derived, not stored

**Decision**: An edge's state (FR-006) is computed from its row and its newest attempt.

- `unsent` when text is null.
- `replying`, `answered`, `incomplete`, `stopped` or `failed` from the newest answer's status:
  `pending` → replying, `complete` → answered, and the other three map to themselves.
- A sent edge with no attempt is `failed`. This happens only if storing the pending answer failed.

The API returns it as `state`.

**Rationale**: Answer rows already hold the reply status that v1 kept on messages. A second stored
copy could disagree with it.

**Alternatives considered**:

- A stored `state` column updated on every transition. Rejected for duplicating truth. Transitions
  are still history: every attempt keeps its own row (Article VI).

## R6. Context for a reply

**Decision**: `buildReplyInput(answerId)` walks the ancestors of the answer's question edge with a
recursive CTE, from the origin down to the edge. It turns the path into turns:

- A question edge becomes a user turn.
- An answer becomes an AI turn, but only if its status is `complete`.
- Function edges and outputs are skipped.

The question edge's anchor text (when it has one) is passed as `anchorText`. A quick-branch edge's
`requery_of` edge is never on its path, because the new edge is its sibling (FR-020). The
`ReplyInput` shape is unchanged: `inheritedContext` is empty and the whole path goes in `messages`.
That keeps the providers and their prompt tests untouched. The answer's `pressure_level` and
`reply_model` are read from its row, as in Feature 6.

**Rationale**: FR-007 is the path and nothing else. Siblings and descendants can't appear because
the walk only goes up.

**Alternatives considered**:

- Keeping the inherited/own split. Rejected because the split was an artifact of conversations
  being the unit.

## R7. Canvas: one camera, two layers

**Decision**: One client component, `CanvasHost`, replaces the chat view, the map view and the
`/n/[id]` route. It has two layers:

- **Drawn layer**: the existing PixiJS 8 application with pixi-viewport. It draws node and edge
  shapes, connectors, tree regions, the focused path emphasis, markers' connector stubs and the
  minimap. It contains no text (FR-031).
- **Text layer**: a DOM `div` above the canvas, `pointer-events: none` except on mounted items.
  Its single CSS transform `matrix(s,0,0,s,tx,ty)` is copied from the viewport. Items are
  positioned in world units inside it.
  - The transform is written in the same animation frame as the canvas render (the viewport's
    `moved` and `zoomed` events plus the Pixi ticker), so the layers never drift (FR-029, SC-006).
  - Items use `contain: layout paint style` so a change in one never re-lays out the others.

Overlays that must stay legible are screen-space DOM placed through the same transform but not
scaled: the selection toolbar, the composer, menus and cards (R9).

**Rationale**:

- Real DOM text is the only way to get native selection, the existing offset mapping
  (`data-start`/`data-end`), find-by-eye and accessibility at every zoom (FR-030).
- A single transform on one container makes pan and zoom a compositor operation, not a layout.
- Browsers' minimum font-size settings act on computed `font-size`, not transforms, so text stays
  text when scaled down.

**Alternatives considered**:

- Text drawn on the GPU (BitmapText or MSDF). Rejected: it isn't selectable, which is the one
  non-negotiable (FR-030).
- One transformed element per item. Rejected because it means N style writes per frame instead of
  one.
- An SVG `foreignObject`. Rejected because selection inside it is unreliable across browsers.

## R8. Clipping, budget and culling

**Decision**: Every element has a world-space box. The width is fixed per kind, and the height is
the element's full text height (R10). The text layer mounts text only for elements whose box
intersects the viewport, plus an overscan of half a screen. Each mounted element gets a character
budget:

- **Global budget**: about 120k mounted characters across all items. This is the number the M0
  spike calibrates.
- **Allocation**: the budget is shared in proportion to each item's on-screen area, with a floor of
  24 characters so every visible node shows real text (story 2).
- **Clipping**: an item renders the prefix of its text that fits its budget, cut at a block, then
  word, boundary. It never renders text past the budget. The rest of the box stays empty, and a
  fade marks the cut. Nothing is drawn in place of the missing text (FR-030, FR-032).
- **Zooming in** raises each visible item's share, so more is revealed. Recomputation is throttled
  to animation frames and debounced to camera idle (about 120 ms) for unmounts, so a fast pan
  doesn't thrash the DOM.
- **Pinning (FR-034, SC-007)**: an element is pinned while it holds the document selection, has
  the focused composer with text, or has a reply streaming. A pinned element stays mounted and
  keeps its budget whatever the viewport.
- **Visible set**: computed by brute-force box tests. 5,000 box tests per frame is well under a
  millisecond, so no spatial index is needed.

**Rationale**: At the furthest zoom, every one of 5,000 nodes is in view. Mounting all their full
text (about 8.5M characters) is impossible at 60 fps, and mounting none would violate story 2. A
proportional budget keeps total DOM size constant whatever the zoom. A selection can only cover
mounted text, which gives FR-033 for free.

**Alternatives considered**:

- Mounting only above a zoom threshold. Rejected because it violates "every zoom level".
- Using `content-visibility: auto`. Rejected as the main mechanism because it still creates every
  DOM node. It is kept as a secondary optimization inside items.

## R9. Rendering text outside React

**Decision**: Item text is rendered by an imperative `TextLayer` module, not by React and
ReactMarkdown. Each immutable text is parsed once into a `RichText`: blocks (paragraph, heading,
list item, code, quote) of runs (text, strong, emphasis, code) carrying their source offsets.

- **Parsing**: the same unified and remark-parse parser that react-markdown uses, reading mdast
  directly, promoted from transitive to direct dependencies (no new packages).
- **Caching**: results are cached by element id, since the text never changes (FR-008). A streaming
  answer is re-parsed at most every 100 ms.
- **Building**: the module builds and recycles DOM directly, splitting runs at marker, term and
  suggestion boundaries with the existing `markerRanges.splitByMarkers`. Each run is a
  `span[data-start][data-end]`, so the existing `selectionToAnchor` and `rangeForOffsets` work
  unchanged once their root attribute becomes `data-node-id`.
- **React's role**: React renders only the screen-space overlays (composer, toolbar, side panel,
  cards, menus) and the empty state.

**Rationale**: Mounting thousands of React and ReactMarkdown trees on a zoom step costs tens of
milliseconds per hundred items, far over a 16 ms frame. The plan's assumption already puts the
drawn layer outside React, and the text layer follows the same rule.

**Alternatives considered**:

- React with virtualization. Rejected because it is too slow at the furthest zoom's mount churn,
  as the M0 spike will confirm.
- One `innerHTML` string per item. Rejected because it loses node recycling and makes
  marker/term updates rebuild everything.

## R10. Element sizes and layout

**Decision**:

- **Sizes.** Answers are 480 world units wide, question bubbles 360 and function outputs 320.
  Heights come from a text height estimator: canvas `measureText` over the same font and width,
  with per-word widths cached and block spacing from the CSS.
  - When an item is mounted with its full text, its real `offsetHeight` replaces the estimate in a
    height cache. The cache is in memory and in localStorage, keyed by element id and a
    layout-version constant. Only that element's tree is laid out again.
  - Streaming answers update their height at most every 100 ms.
- **Layout algorithm.** A first-child-aligned tidy tree with variable box sizes, written in house
  (about 200 lines) to replace the d3-hierarchy layout:
  - The first child of an element, the earliest created child that isn't an anchored branch, sits
    directly below it. That makes a run of question, answer, question, answer a column (FR-036).
  - Later children (branches, quick branches, re-asks, extra attempts and function edges) are
    placed to the right.
  - Subtree contours are kept apart by a fixed gap, so siblings never overlap (edge case).
  - An anchored branch's connector leaves its source at the vertical position of its span,
    estimated as `start / length × height` and refined when the span is mounted.
- **Hand placement.** Hand-placed elements (`manual_x/y`) override their computed position and
  nothing else (FR-037). Their auto-laid children are still placed from the computed position, as
  in Feature 2.
- **Trees.** Tree placement keeps the Feature 2 rules in `forestLayout`: only changed,
  non-user-placed trees may move, and only to avoid overlap (FR-036, FR-038, FR-039, SC-009).

**Rationale**: Reading down a column is what the camera follows. Fanning to the right keeps the main
line still when a branch is added. d3-hierarchy's `nodeSize` is fixed-size and centres parents,
which moves the main line on every branch.

**Alternatives considered**:

- d3-flextree. Rejected: it still centres parents over children.
- Measuring every element in a hidden DOM at load. Rejected as too slow for 5,000 elements within
  1 s (SC-005).

## R11. Camera follows the user, or nothing

**Decision**: A small state machine in `src/canvas/camera.ts` has two modes, `follow(targetId)`
and `free`.

- **Entering follow.** A send, or a walk (marker click, parent/child/sibling keys, side panel
  entry, definition link), sets `follow` and glides (pixi-viewport `animate`, 350 ms, or instantly
  with reduced motion) to fit the target.
- **While following.** If the target is a streaming answer, each height change re-fits so its
  bottom stays in view.
- **Leaving follow.** Any manual pan, zoom or pinch (`drag-start`, `wheel`, `pinch-start`) sets
  `free`.
- **No other event moves the camera** (FR-025, SC-008). Data arriving, a function output, another
  tree growing or a relayout all leave it alone. A relayout applies a compensating offset only
  while following, so the target stays put on screen.
- **Minimap.** Clicking or dragging in it moves the camera directly and sets `free`.
- **Single click.** A click focuses an element without moving the camera. Story 5 says to click a
  node to read it, and it is already on screen.

Input mapping changes for a text canvas:

- A plain wheel or two-finger scroll pans.
- Ctrl or Cmd plus wheel, or a pinch, zooms.
- Dragging on the background pans.
- Dragging on an element's frame (its padding and header strip, never its text) moves the element,
  and Alt-drag moves its tree. A tree can also be moved by its origin edge's frame.
- A press on text starts a native selection and never a drag (story 6, FR-037).

Zoom is clamped between 0.02 and 4, and further limited so the project bounds never shrink below a
quarter of the screen.

**Rationale**: The spec's camera contract is a two-state rule. Making it an explicit, unit-tested
state machine is what makes SC-008's "0 moves from any other event" checkable. Wheel-to-zoom
(today's map) fights reading long text on a trackpad.

**Alternatives considered**:

- Auto-follow with a timeout after a manual pan. Rejected because the spec says the camera stays
  free until the next send or walk.

## R12. The composer is a screen-space overlay

**Decision**: The composer is a fixed-size DOM overlay pinned below the focused element's on-screen
box, or below an unsent edge stub. It is placed through the camera transform but never scaled.

- When the focused element is off screen, the composer docks to the nearest viewport edge with a
  pointer toward the element.
- Its text is real, selectable text (FR-030).
- Drafts are kept per target element id in the persisted view store (localStorage), so they survive
  reloads (FR-028).
- Composer state:
  - Send is disabled while the focused element's newest answer is streaming, and Stop is shown
    instead (FR-011).
  - A focused function output, rejected or not, has no composer. Outputs are leaves in v0.2, so
    nothing builds on unconfirmed AI derivations (Article I).

**Rationale**: A world-space composer would shrink to nothing when zoomed out. A screen-space one
is always usable while still visibly attached to its element.

## R13. Data loading and updates

**Decision**:

- `GET /api/canvas?projectId=` returns every element of the project with full text, plus trees,
  notes, markers (anchors live on edges), review state and the saved camera. That is about 8.5 MB
  of JSON at 5,000 elements with today's average reply length, served from 127.0.0.1.
- Actions return the rows they created, and the client merges them.
- Each pending answer streams over Server-Sent Events by answer id (the Feature 2 mechanism, keyed
  by answer id instead of message id).
- The canvas refetches on window focus and every 10 s while visible. That covers definition drafts
  and other tabs.
- No summary polling remains.

If the M0 spike shows the 1 s open target (SC-005) failing on payload size, the fallback is a
two-phase load: structure with 400-character prefixes and stored text lengths first, then full
text in pages.

**Rationale**: It is the simplest design that meets the target on a local machine. The fallback is
named so planning doesn't stall on it.

## R14. Kinds and functions on edges (from Feature 009)

**Decision**: The 009 registries carry over with these changes.

- **Kind declarations** gain `shape: "node" | "edge"` (FR-043) and `display`. `display` is one of
  `answer`, `question`, `function_connector` or `output`, and replaces `view` and `mapLabel`.
  `conversationBacked` is dropped.
- **Kinds shipped**: `answer`, `question`, `function` and `analogy` (FR-044).
- **Readers** shrink to one, `text`: the source node's own immutable text.
- **Analogy** v2 reads an answer's text (its version is bumped to 2). Its instruction keeps the
  009 rule that every claim about the idea must come from the input (Article III).
- **Running a function**:
  1. A menu run creates a function edge (parent = input node), then generates.
  2. On success, it inserts the output as the edge's child. On failure, it inserts nothing at all;
     the edge and output are written in one transaction after the AI call (FR-052).
  3. "Run again" on an existing function edge adds another output under the same edge (FR-051).
     That edge's settings override applies to it (FR-053).
  4. A first run from the menu uses kind-level values or defaults.
- **Reviews** are an append-only `output_reviews` table (`confirmed` or `rejected`, newest wins).
  A rejection hides the output, and its edge when no visible output remains, unless "Show
  rejected" is on (FR-050).
- **Dropped from 009**: output versions and the stale badge, as the spec assumption says.
- **Settings**: `kind_setting_changes` is recreated in `public` with `node_id` referencing v2 nodes.
  Kind-level rows are copied over, and 009 per-output overrides are copied onto the matching
  function edge.

**Rationale**: The runner stays generic (FR-046, SC-013). A second function or kind is a new
declaration file and a registry line, proven by a test that registers both and runs them through
the same runner.

## R15. Summaries switched off

**Decision**:

- The summary queue, `summaryAfterReply`, the refresh routes and the map label code are removed
  from the running app.
- `v1.node_summaries` keeps every summary.
- The provider's `summarize` method stays in the interface for a later summaries layer, with no
  caller.
- A guard test asserts that no code under `src/` calls `summarize(` except the provider
  implementations (SC-014).

## R16. Carried-over features

- **Definitions**: captured from any node or edge text that is complete. `definitions.source_id`
  (new, references v2 nodes) replaces the conversation and message pair for new captures. Old
  rows keep their v1 columns and get `source_id` backfilled to the same message id, which is now
  the element id. A definition's link opens `/?focus=<id>&span=<start>-<end>` (FR-055).
- **Suggested underlines**: unchanged logic (bold runs), applied by the text layer to complete
  answers only (FR-056).
- **Feedback**:
  - The `feedback_view` type gains `canvas`. `feedback_items` gains `project_id` and `element_id`.
  - The check that ties `node_id` to `chat` is replaced by one that allows `element_id` only with
    `canvas`.
  - Old items keep their view and node and get `element_id` = the first edge of their conversation
    (FR-058, FR-066).
  - The export file prints the element's kind and an excerpt.
- **Projects**: unchanged, with the canvas as the project view. Trashed projects' trees are never
  loaded (FR-059).
- **Parked tangents**: recreated in `public` against v2 elements, with offsets on the element's
  text, and the same event semantics. Fired events point at the created edge. Discarding stays an
  explicit user choice (spec assumption).
- **Reply settings**: unchanged and global, recorded on each answer row (FR-057).
- **Visual language**: question edges render as Feature 7 user bubbles and answers as plain text
  with the AI tag. The composer keeps its rounded input and icon buttons (FR-060).

## R17. Proving scale first (milestone M0)

**Decision**: Before any migration or feature work, a throwaway spike route, `/dev/canvas-spike`,
enabled only with `FARABI_TEST_HOOKS`, renders 5,000 synthetic elements with real text through the
R7 to R9 text layer.

- **It measures**:
  - frame times while panning and zooming from the furthest to the closest zoom, sampled with
    `requestAnimationFrame` over 5 s in the production build with GPU Chromium (the existing
    Playwright setup)
  - time to first full render
  - mounted character and element counts
- **Pass**: the 95th-percentile frame time is under 16.7 ms while panning and under 20 ms during
  zoom steps, the first render takes under 1 s, and the furthest zoom selection opens the toolbar.
- **If it fails**, try these in order:
  1. a lower global budget
  2. fewer mounted elements at the furthest zoom, keeping the 24-character floor only for elements
     larger than 6 screen pixels
  3. splitting the text layer into four tiled containers
  4. the two-phase load (R13)
- The spike's numbers go into `research.md` before the real text layer is built.

**Rationale**: The spec's own assumption makes this an early milestone. Everything else depends on
it being true.

### M0 results (2026-10-01, owner's machine, production build, GPU Chromium, 1280×720, 60 Hz)

**Verdict: PASS.** Three consecutive runs of `tests/e2e/f10-m0-spike.spec.ts` passed on 5,000
synthetic answers (mean about 1,700 characters, up to 8,000, with markdown).

| Measure | Target | Run 1 | Run 2 | Run 3 |
|---------|--------|-------|-------|-------|
| Text layer ready, from receiving items | < 1 s | 298 ms | 340 ms | 270 ms |
| Page ready, from navigation (includes generating synthetic data) | | 996 ms | 1,059 ms | 837 ms |
| Pan p95, all 5,000 in view | ≤ 16.7 ms frame (60 Hz) | 16.8 (301/300 frames) | 16.8 (297) | 16.7 (301) |
| Pan p95 at 0.35 / 1.0 zoom | | 16.7 / 16.8 | 16.7 / 16.7 | 16.7 / 16.7 |
| Zoom-in steps p95, 0.02 → 4 | | 16.7 (300) | 16.8 (300) | 16.8 (301) |
| Zoom-out steps p95 | | 16.8 (295) | 16.7 (298) | 16.8 (299) |
| Selection at the furthest zoom (0.02, glyphs ≈ 0.3 px) | toolbar-ready selection | "Servic" | "Servic" | "Servic" |
| Mounted at the furthest zoom | every element | 5,000, 22,193 chars | same | same |
| Off-screen mounted after rest, zoomed in | 0 | 0 | 0 | 0 |

A p95 of 16.7–16.8 ms is one refresh interval: no dropped frames at the 95th percentile.

**What it took**:

| Change | Before | After |
|--------|--------|-------|
| **Budget**: the total and floor dropped from 120,000 and 24 to **30,000 and 6**. Paint cost follows mounted characters. 30k still fills a zoomed-in screen (about 10k characters at scale 1), and every element keeps at least 6 characters of real text. | far-zoom pan p95 33 ms (106k characters mounted) | 16.8 ms |
| **Preview path**: elements with a budget of 120 characters or less read the first line with markdown syntax skipped and offsets kept (`previewRichText`), with no parser. | open 3.1 s | 0.42 s |
| **First fill** runs 48 ms work slices instead of 6 ms (`FIRST_FILL_WORK_MS`). | | |
| **Resizes wait for rest**: mounted items keep their text while the camera moves, and resize 100 ms after it rests. Items coming into view still mount immediately. | zoom-in p95 33 ms | 16.7 ms |

**Ruled out**:

- **`will-change: transform` on the text world.** It composited a world-sized layer that never
  finished its first render (more than 60 s).
- **Measuring with Playwright tracing on.** Its snapshots cost frames, so the spec sets
  `trace: "off"`.
- **A `mask-image` fade on clipped text (found 2026-10-07).** Zoomed out, every item is clipped,
  and masking thousands of items took far-zoom pan p95 from 16.8 ms to about 400 ms. The cut is
  marked with " …" only.
- **Timing the very first gesture after load.** It also pays JIT and GPU start-up, so the spec
  warms up with a 1 s pan first. Steady-state repeats in one session all held p95 ≤ 16.8 ms.

**Carried into the real text layer**:

- the constants in `src/canvas/text/budget.ts`
- `richTextPrefix` and `previewRichText` in `src/canvas/text/richText.ts`
- the scheduling in `src/canvas/text/TextLayer.ts`
- forwarding wheel events from text to the canvas
- the input mapping from research R11: plain wheel pans with `drag({ wheel: true })` and
  `wheel({ wheelZoom: false, trackpadPinch: true })`, and Ctrl/Cmd + wheel zooms

## R18. Routing

**Decision**:

- `/` renders the canvas of the open project. `?focus=<id>` and `&span=` focus and walk to an
  element or span.
- `/n/<id>` permanently redirects to `/?focus=<id>`. For a v1 conversation id, it goes to that
  conversation's first edge, resolved through the ledger, so old links and feedback context keep
  working.
- `/map` redirects to `/`. The view toggle and the "new conversation" button are removed. Typing in
  the empty canvas or the "New tree" composer state starts a tree (FR-010).
- `/definitions` and `/settings` stay.

Next 16 App Router conventions apply. Implementers read `node_modules/next/dist/docs/` before
writing routes, as `AGENTS.md` requires.
