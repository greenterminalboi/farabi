# Feature Specification: Farabi v0.2 — Message Graph and Canvas

**Feature Branch**: `010-v02-message-graph-canvas`

**Created**: 2026-10-01

**Status**: Draft

## Clarifications

### Session 2026-10-01

- Q: What is the basic unit now? → A: The message, not the conversation. Every AI reply is a node and
  every user message is an edge. A conversation becomes a path through the graph, and a branch is a
  second edge leaving a specific node (FR-001–FR-005).
- Q: Why is a user message an edge and not a node? → A: A user message is an act (it steers), and an
  AI reply is content. Edges hold the act and nodes hold the content, so provenance falls out of the
  structure: user-written things are edges, AI-written things are nodes (FR-002–FR-003).
- Q: How does a tree begin? → A: With an origin edge, a user message with no source node. The first
  AI answer is the tree's root node, so a root is an answer like every other node (FR-005).
- Q: Can an edge be something other than a user message? → A: Yes. An edge is a special kind of node
  and has a kind. This feature ships two: the question edge (a user message) and the function edge
  (a stored function being applied). Schema boundaries, couplings and other kinds are out of scope
  (FR-043–FR-045).
- Q: Is there still a chat view and a map view? → A: No. There is one canvas per project. Reading a
  conversation and moving through the map are the same act (FR-023).
- Q: How does the camera behave? → A: It follows the edges the user walks and their nodes, and leaves
  the user alone once they pan or zoom themselves (FR-025).
- Q: Must text be selectable at every zoom level? → A: Yes, non-negotiable. All text is real text
  laid over the canvas, selectable from the closest zoom to the furthest. It is clipped when small
  and never replaced by a drawing (FR-030–FR-034).
- Q: How many zoom levels are there? → A: None fixed. Zoom is continuous (FR-024).
- Q: What happens to summaries? → A: They are set aside. Generation and display are off in v0.2 and
  existing summaries are kept. They may return later as a toggleable layer (FR-062).
- Q: What happens to Feature 009? → A: It is folded in. Its function machinery (kinds, function
  definitions, one runner, Analogy, settings per kind) is carried over and re-expressed on edges,
  and this feature replaces 009 as the next one to specify (FR-043–FR-054).
- Q: Is this one feature or several? → A: One, deliberately. The data model, canvas, text layer and
  function machinery depend on each other too closely to ship separately.

**Depends on**: Features 001 to 008 (`specs/001-branching-chat-map/` through
`specs/008-branch-queue-and-parking/`), all of which this feature restructures or carries forward.
Feature 004 (Projects) sets the canvas boundary. Feature 006 (Information Pressure) supplies the
global reply settings. The Feature 009 draft (`specs/009-node-function-foundation/`) is superseded
by this feature.

**Input**: Farabi's conversation-as-unit model forces a switch between chat and map, and makes the
map a picture of chats instead of the place where thinking happens. The proposal is to flatten
everything: every AI answer becomes a node on one large canvas, every user message becomes an edge
carrying the question, and a branch is just another edge leaving the exact answer or text it came
from. The camera follows the path the user walks, zoom is continuous so the map can grow large, and
a minimap shows the whole. All text stays real, selectable text at every zoom level because
highlight-to-branch, Define, Park and later features depend on it. Existing data migrates without
loss.

### Constitution Check

| Article | How this feature meets it |
|---------|---------------------------|
| I. The User Is the Final Authority | Answer nodes and function outputs are ai-suggested; question edges are user-authored; confirmations are user-confirmed. Rejected outputs are never treated as confirmed material. |
| II. Growth Is Additive, Never Reconciled | Migration retains the original data; retries and regenerations add siblings instead of replacing; rejections are recorded and hidden, not removed. No node or edge can be deleted. Sibling attempts are independent nodes, never versions to reconcile. |
| III. Nothing Is Invented Ahead of Evidence | AI material is presented as AI: answer nodes keep the AI tag and function outputs are marked AI-generated wherever they appear. Analogy works only from the source node's own text and runs only on request. |
| IV. User-Led Exploration Takes Priority | The AI never starts a branch; functions run only on explicit action; the camera follows the user and never pulls them elsewhere. |
| V. Compression Preserves Meaning, Not Just Length | Summaries, the only compressed representation, are switched off. Clipped text at low zoom is the node's own text, cut off rather than rewritten, and zooming in reveals the full-fidelity version. Every node traces to the edge that produced it, every function output to its function and version, every definition to its source text. |
| VI. History Is Data, Not Decoration | Creation times, every attempt, every setting change and every state transition are kept. |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ask on the canvas and watch the answer arrive (Priority: P1)

The user opens a project and types a question. The question appears as an edge, an answer node
grows at its end as the reply streams in, and the camera glides to keep it in view. They type a
follow-up and the path extends. There is no separate chat screen: this is the conversation.

**Why this priority**: Everything else is organized around this loop. Without it the canvas is a
picture and the product is not a chat tool.

**Independent Test**: In an empty project, type a question. Confirm an origin edge and an answer node
appear and stream. Send a follow-up from that answer and confirm a second edge and node extend the
path with the camera following.

**Acceptance Scenarios**:

1. **Given** a project with no trees, **When** the user types and sends a message, **Then** an origin
   edge is created with no source, a new tree begins, and the first answer node is its root.
2. **Given** an answer node is focused, **When** the user sends a message from its composer, **Then** a
   question edge from that node and a new answer node are created.
3. **Given** a reply is arriving, **When** text is generated, **Then** it appears progressively inside
   the answer node, with Stop available.
4. **Given** the focused node already has a child edge, **When** the user sends another message from
   it, **Then** a second, sibling edge is created and the first is unchanged.
5. **Given** the AI service is unreachable, **When** the user sends a message, **Then** a clear error
   with retry is shown and the typed text is not lost, while reading and navigating still work.

---

### User Story 2 - Read and select text at any zoom (Priority: P1)

The user zooms out until the whole tree is in view. Every node still shows real text, clipped to what
fits. They drag across a visible phrase and the Define, Branch and Park toolbar appears, exactly as
when zoomed in. Zooming in reveals the rest of the text.

**Why this priority**: Selectable text is the foundation of branching, definitions and parking, and
the requirement was set as non-negotiable at every zoom level.

**Independent Test**: At the furthest zoom, select a visible phrase in a node and confirm the toolbar
appears. Zoom to the closest level and select a phrase in the same node. Confirm both selections work
and that text outside the viewport is not mounted.

**Acceptance Scenarios**:

1. **Given** any zoom level, **When** a node or edge is in the viewport, **Then** its text is real,
   selectable text, never a drawing.
2. **Given** a node whose text is larger than its on-screen size, **When** it is shown, **Then** the
   text is clipped to what fits and more is revealed as the user zooms in.
3. **Given** a selection on clipped text, **When** the user selects, **Then** only the visible portion
   is selectable, and zooming in extends what can be selected.
4. **Given** a node holds a selection or a focused composer with text, **When** the user pans it out
   of the viewport, **Then** it stays mounted and the selection is not lost.
5. **Given** definition underlines, branch markers and suggested underlines, **When** they apply to
   mounted text, **Then** they render there as before and selection still works over them.

---

### User Story 3 - Branch from anywhere (Priority: P1)

The user highlights a phrase in an answer, or in their own question on an edge, and chooses Branch.
A branch stub hangs off that exact text with a composer waiting, preloaded as before. They can also
send a new message from a node that already has children, type `????` to re-ask a question from the
same source, or click a parked tangent.

**Why this priority**: Branching is the core behavior of the product, and every gesture built so far
has to keep working in the new model.

**Independent Test**: Highlight a phrase in an answer and branch; highlight a phrase in a question
edge and branch; send `????`; park a tangent and click it. Confirm each produces the right edge with
the right source and marker.

**Acceptance Scenarios**:

1. **Given** a highlighted span in a node's or edge's text, **When** the user chooses Branch, **Then**
   an unsent edge is created immediately, anchored to that exact span, with a marker on the source at
   that span and a composer waiting for the user's message.
2. **Given** an unsent branch, **When** the user sends a message, **Then** the edge becomes a sent
   question edge and a reply is requested. The AI never starts a branch by itself.
3. **Given** the focused answer was produced by a question edge with a source, **When** the user sends
   exactly `????`, **Then** a sibling question edge with the same text is created from that same
   source, the reply is requested automatically, and `????` is never sent to the AI.
4. **Given** a parked tangent with a typed question, **When** the user clicks it, **Then** an edge is
   created and fired automatically; **Given** one without a typed question, **Then** an unsent edge is
   created with the composer preloaded with the anchor text.
5. **Given** a node with several branches, **When** it is viewed, **Then** each has its own marker
   leading to its own edge, with no depth limit.

---

### User Story 4 - Existing work survives the move (Priority: P1)

The user opens Farabi after the upgrade. Every conversation, branch, marker, definition, parked
tangent, hand-placed position and feedback item from Features 001 to 008 is still there, now shown as
nodes and edges on the canvas. Nothing was deleted, and the original data is still on disk.

**Why this priority**: This is a rebuild of the core model on top of real working data. A migration
that loses anything would undo the trust the whole product is built on.

**Independent Test**: Run the migration on a copy of real data. Compare, per conversation, the ordered
text of every message before and after. Confirm every marker, definition, parked tangent and position
is present, and that the original data is untouched.

**Acceptance Scenarios**:

1. **Given** an existing conversation, **When** it is migrated, **Then** its ordered messages are
   reproducible from the path of edges and nodes, with identical text and times.
2. **Given** an existing branch with an anchor, **When** it is migrated, **Then** its first edge is
   sourced from the node or edge containing the anchor, with the same span and marker.
3. **Given** a branch with no messages yet, **When** it is migrated, **Then** it becomes an unsent edge
   waiting for its first message.
4. **Given** the migration finishes, **When** the original data is inspected, **Then** it is unchanged
   and still present.
5. **Given** the migration is interrupted or run again, **When** it resumes, **Then** it produces the
   same result without duplicating anything.

---

### User Story 5 - Move around a big map (Priority: P2)

The map has grown to thousands of nodes. The user walks from one answer to its parent and the camera
glides along the edge. They pan to look at another tree and the camera stays put. They use the
minimap to jump across the canvas, then click a node to focus it and read.

**Why this priority**: The canvas has to stay usable at the size the product is meant to reach, but
it matters after the loop and the text layer work.

**Independent Test**: With a large map, walk several edges and confirm the camera follows. Pan away
and confirm it does not move on its own. Click and drag in the minimap and confirm the camera follows.
Reopen the project and confirm the last camera position returns.

**Acceptance Scenarios**:

1. **Given** the user sends a message or walks along an edge, **When** they do, **Then** the camera
   glides to keep the node they moved to, and a streaming reply, in view.
2. **Given** the user pans or zooms by hand, **When** anything else changes, **Then** the camera does
   not move until the user next sends or walks.
3. **Given** a project, **When** the minimap is shown, **Then** it shows every node as a point, trees
   visibly separate, and a rectangle for the current viewport.
4. **Given** the minimap, **When** the user clicks or drags in it, **Then** the camera moves there.
5. **Given** a focused node, **When** the user looks at the canvas, **Then** the path of ancestors the
   AI works from is visibly emphasized.

---

### User Story 6 - Rearrange by hand and keep notes on edges (Priority: P2)

The user drags a tree nearer to a related one and moves one node to where it belongs in their head.
They add a short note to an edge. Positions and notes persist, and nothing about the structure
changes.

**Why this priority**: These are Feature 002 behaviors that must carry over, and the canvas is a
workspace only if they do.

**Independent Test**: Drag a tree and one node, add a note to an edge, reload, and confirm all persist
and no connection changed.

**Acceptance Scenarios**:

1. **Given** the canvas, **When** the user drags a tree, **Then** the whole tree moves, including
   hand-placed nodes, and stays after a reload.
2. **Given** the canvas, **When** the user drags one node, **Then** only that node moves, its edges
   follow, and no drag can detach, attach or re-parent anything.
3. **Given** a hand-placed node or tree, **When** new nodes are added nearby, **Then** it is never
   moved automatically.
4. **Given** an edge, **When** the user adds, edits or clears a note, **Then** it is shown with the
   edge, and every change is recorded.
5. **Given** a click on a node and a drag on a node, **When** each ends, **Then** the click focuses the
   node and a drag never does.

---

### User Story 7 - Retry without losing anything (Priority: P2)

A reply fails halfway, or the user wants a different answer. They retry or regenerate and a new
answer node appears beside the old one. The old answer, including anything branched from it, is
still there.

**Why this priority**: It removes a Feature 001 restriction and makes Article II visible on the map,
but the loop works without it.

**Independent Test**: Branch from an answer, then regenerate that answer. Confirm a sibling answer
appears, the original and its branch remain, and neither is edited.

**Acceptance Scenarios**:

1. **Given** an edge whose reply was interrupted or stopped, **When** the user retries, **Then** a new
   answer node is created from the same edge, and the partial one is kept unchanged.
2. **Given** an answered edge, **When** the user regenerates, **Then** a new sibling answer is created
   and the earlier answer remains.
3. **Given** an answer that has branches, **When** the user regenerates, **Then** it is allowed and the
   branches stay attached to the original answer.

---

### User Story 8 - Run a function on a node (Priority: P3)

The user selects an answer and runs Analogy. A function edge leaves the node and an analogy node
appears, marked AI-suggested. They confirm it, reject it, or run it again for another version. Each
kind has its own settings, set once for the kind with an optional override on the edge that ran.

**Why this priority**: It proves the function and kind machinery that later features need, but the
product works without it.

**Independent Test**: Run Analogy on an answer, confirm the edge and output node appear marked
AI-suggested, confirm one and reject another, and change a kind setting without triggering a run.

**Acceptance Scenarios**:

1. **Given** a node, **When** the user opens the function menu, **Then** it lists only functions that
   accept that node's kind.
2. **Given** Analogy is run, **When** it succeeds, **Then** a function edge and an output node are
   created in the same project and tree, both ai-suggested.
3. **Given** a proposed output, **When** the user confirms it, **Then** it becomes user-confirmed;
   **When** the user rejects it, **Then** the rejection is recorded and it is hidden by default.
4. **Given** a function is run again, **When** it succeeds, **Then** a new output node is added beside
   the old one and nothing is replaced.
5. **Given** a setting is changed, **When** it is saved, **Then** it is recorded and no function runs
   as a result.

---

### User Story 9 - Everything else keeps working (Priority: P2)

Definitions, suggested underlines, the feedback button, projects, the Parked tab, information
pressure and the reply model all still work on the canvas, adapted where the unit changed.

**Why this priority**: The overhaul is only a gain if it does not cost what was already built.

**Independent Test**: Exercise each carried-over feature on the canvas and confirm it behaves as its
own spec says.

**Acceptance Scenarios**:

1. **Given** a collected term, **When** it appears in any mounted text, **Then** it is underlined and
   its hover card works.
2. **Given** a completed answer node, **When** it is shown, **Then** suggested underlines appear on it
   and clicking one selects that text.
3. **Given** the feedback button, **When** feedback is submitted, **Then** its context records the
   project and the focused node or edge.
4. **Given** a project switch, **When** it happens, **Then** the canvas for that project is shown and a
   reply in progress in another project continues and is stored.

---

### Edge Cases

- **Branching from the user's own words**: the selected text lives on a question edge, so the new
  edge's source is that edge. This is the one case where an edge is the source of another edge.
- **Selection across more than one node or edge**: not supported; a selection lies within a single
  node's or edge's text.
- **`????` with no re-askable source**: where the focused answer came from an origin edge, a function
  edge, or no question edge, it is sent as an ordinary message. A second `????` from the same source
  falls back to an ordinary message instead of branching again.
- **Two user messages in a row with no reply between them**: the second question edge is sourced from
  the first edge.
- **Regenerating an answer that has branches**: allowed; the branches stay on the original answer.
- **A reply streaming while the user pans away**: the reply keeps arriving and its node stays mounted;
  the camera does not chase it.
- **A streaming node grows**: nodes below it in the same chain move down; hand-placed nodes and other
  trees do not move.
- **A node with many children**: they fan out without overlapping their siblings' subtrees; exact
  rules are left to planning.
- **An empty project**: the canvas shows an empty state that invites a first question.
- **A tree in a trashed project**: handled by Feature 004 and not visible on any canvas.
- **Overlapping markers and underlines**: all remain visible and usable, as in Features 001 and 002.
- **Hand-placed nodes dropped on others**: allowed; overlap is the user's choice.
- **Zooming past the furthest or closest practical level**: the camera stops at sensible limits rather
  than losing the map or the text.

## Requirements *(mandatory)*

### Functional Requirements

#### Graph model

- **FR-001**: The node MUST be the basic unit of the application. In this feature, "node" means a
  node that holds content and "edge" means an edge-kind node that holds an act; both have a kind and
  both are nodes in the unified model.
- **FR-002**: Every user message MUST be an edge of kind question, recording the user's exact text,
  its creation time, and a user-authored state.
- **FR-003**: Every AI reply MUST be a node of kind answer, holding the reply text, its reply state,
  the information pressure level and reply model used, its creation time, and an ai-suggested state.
- **FR-004**: A question edge MUST have a source (an answer node, or another edge when branching from
  the user's own text), except for an origin edge, and MAY produce an answer node on each attempt.
- **FR-005**: A tree MUST begin with an origin edge, a question edge with no source, and the first
  answer node MUST be the tree's root. A tree is a connected group of nodes and edges sharing one
  origin edge; different trees never share any.
- **FR-006**: A question edge MUST carry one of these states: unsent, replying, answered, incomplete,
  stopped, or failed.
- **FR-007**: The context given to the AI for a reply MUST be the path of edges and nodes from the
  tree's origin to the edge's source, plus the anchor text for a branch, and nothing from siblings or
  descendants (Feature 001, FR-005).
- **FR-008**: The text of a sent edge and of any node MUST NOT change after it is sent or generated,
  and no node or edge can be deleted (Feature 001, FR-028).
- **FR-009**: Every node and edge MUST record its project, tree, kind, provenance state, origin (how
  it came to exist), and creation time.

#### Asking and replies

- **FR-010**: Each focused node MUST have a composer. Sending a message from it MUST create a question
  edge from that node and request a reply. With no tree present, sending MUST create an origin edge.
- **FR-011**: Replies MUST stream progressively into the answer node, with Stop, and an incomplete or
  stopped reply MUST keep its text, be marked, and offer Retry (Feature 002, FR-001–FR-003a).
- **FR-012**: A reply MUST continue arriving and be stored even if the user pans away, switches
  project, or leaves the node (Feature 002, FR-004).
- **FR-013**: Sending from a node that already has a child edge MUST create an additional sibling edge
  and MUST NOT change any existing one.
- **FR-014**: The opening edge MUST accept any text; no question format is enforced.
- **FR-015**: When the AI service cannot be reached, users MUST still be able to read, select and
  navigate the whole canvas; sending MUST show a clear error with retry, and unsent text MUST NOT be
  lost (Feature 001, FR-032).

#### Branching

- **FR-016**: Users MUST be able to highlight any non-empty span within a single node's or edge's text
  and see the Define, Branch and Park toolbar.
- **FR-017**: Choosing Branch MUST immediately create an unsent edge whose source is the node or edge
  containing the span and whose anchor is exactly the highlighted text. A marker MUST appear at that
  span, and the composer MUST open preloaded as Feature 008 defines (the inline question if typed,
  otherwise the anchor text). The AI MUST NOT start the branch.
- **FR-018**: A marker MUST be persistent and exact; selecting it MUST move the camera to its edge.
- **FR-019**: A node or edge MAY have any number of markers, including on overlapping text, with no
  depth limit.
- **FR-020**: A message of exactly `????` MUST NOT be sent to the AI when a quick branch is possible.
  It MUST create a sibling question edge from the source of the edge that produced the focused
  answer, carrying that edge's exact text, request the reply automatically, and move the camera to
  it. The context MUST exclude the re-asked edge (Feature 002, FR-006–FR-013). It MUST be an ordinary
  message when no such source exists or the same re-ask has already been made.
- **FR-021**: Parked tangents (Feature 008) MUST be attachable to any node or edge text. Clicking one
  with a typed question MUST create the edge and fire it automatically; clicking one without MUST
  create an unsent edge with the composer preloaded with the anchor text.
- **FR-022**: The side panel MUST show, for the focused node or edge, its direct child edges and its
  parked tangents.

#### Canvas, camera and minimap

- **FR-023**: Each project MUST have one canvas showing every node and edge of every tree in it. The
  separate chat view and map view MUST be removed. Switching project MUST switch canvas.
- **FR-024**: Pan and zoom MUST be continuous, with no fixed number of zoom levels.
- **FR-025**: When the user sends a message or walks to another node or edge (by marker, parent or
  child navigation, side panel, or minimap), the camera MUST glide to keep it, and a streaming reply,
  in view. Once the user pans or zooms by hand, the camera MUST NOT move on its own until their next
  send or walk. No other event, including a function output arriving or another tree changing, may
  move the camera.
- **FR-026**: One node or edge MUST be focused at a time, the composer attaches to it, and the path of
  ancestors that provides its context MUST be visibly emphasized. This replaces Feature 001's
  inherited-context display (FR-033).
- **FR-027**: A minimap MUST be available for the project, showing every node as a point, trees
  visibly separate, and the current viewport as a rectangle. Clicking or dragging in it MUST move the
  camera. It MUST be hideable.
- **FR-028**: The last camera position for each project MUST be restored on reopening, and unsent
  composer text MUST be preserved per draft (Feature 001, FR-022).

#### Text layer

- **FR-029**: A single camera transform MUST drive both the drawn layer and the text layer so they
  never drift apart.
- **FR-030**: All text, including the text of nodes and edges, notes, and composers, MUST be real,
  selectable text at every zoom level, and MUST NOT be replaced by a drawing.
- **FR-031**: The drawn layer MUST draw only what is not text: edges, node shapes, tree regions, and
  the minimap.
- **FR-032**: Text MUST be mounted only for nodes and edges in the viewport, clipped to what fits at
  their on-screen size, with more revealed as the user zooms in.
- **FR-033**: A selection on clipped text MUST be limited to the visible portion, and selecting MUST
  never require mounting hidden text.
- **FR-034**: A node or edge holding a selection, a composer with text, or a reply in progress MUST
  stay mounted when it leaves the viewport.
- **FR-035**: Definition underlines and hover cards, branch markers, and suggested underlines MUST
  render on all mounted text as their own specs define, without preventing selection.

#### Layout and hand placement

- **FR-036**: Automatic layout MUST lay a run of question edges and answers out as a column and fan
  branches out sideways from their source. Adding to one tree MUST NOT move any other tree (Feature
  001, FR-023) or any hand-placed node.
- **FR-037**: Users MUST be able to drag a whole tree and drag an individual node. Positions MUST be
  relative to the tree and persist. Dragging MUST NOT change any connection. A click MUST focus a
  node and a drag MUST NOT (Feature 002, FR-015–FR-022).
- **FR-038**: A tree the user has placed MUST never be moved automatically (Feature 002, FR-020).
- **FR-039**: The growth of a streaming node MUST NOT move any hand-placed node or any other tree.
- **FR-040**: Users MUST be able to attach one short note to any edge, and edit or clear it. Every
  change MUST be recorded. This preserves Feature 002's edge labels (FR-023–FR-026).

#### Retry and regenerate

- **FR-041**: Retrying or regenerating a reply MUST create a new answer node from the same edge as a
  sibling attempt. Every earlier attempt, and everything branched from it, MUST be kept unchanged.
- **FR-042**: Regeneration MUST remain available after a branch exists on the reply. Feature 001's
  restriction (FR-029) no longer applies.

#### Kinds, functions and settings (carried over from the Feature 009 draft)

- **FR-043**: A node or edge kind MUST be defined by a declaration (data) stating its name, whether it
  holds content or an act, how it is shown, the settings it declares, and, for function outputs,
  which kinds may be its input.
- **FR-044**: This feature MUST provide these kinds: answer, question edge, function edge, and
  function output.
- **FR-045**: A function MUST be defined as data stating an id, a version, a name, the kinds it
  accepts, the part of the input it reads, the instruction that produces its output, the kind of
  output it creates, and its procedure.
- **FR-046**: One generic runner MUST execute any function definition. Adding a function or a kind
  MUST require only adding a definition, with no change to the runner. This is a hard requirement.
- **FR-047**: A function MUST run only on an explicit user action on a node whose kind it accepts. Its
  input and output MUST be within the same project.
- **FR-048**: Analogy MUST read the source node's text and create a function edge from the source and
  a function output node, in the source's tree, both ai-suggested. The function edge MUST record the
  function id and version and the source it read.
- **FR-049**: A function edge MUST be directional and not reversible, and MUST be drawn differently
  from question edges, with a proposed one shown as more tentative than a confirmed one.
- **FR-050**: The user MUST be able to confirm a function output, marking it user-confirmed, or reject
  it. A rejection MUST be recorded, not deleted, and the output and its edge MUST be hidden by
  default.
- **FR-051**: Running a function again MUST add a new output node beside the old one. A confirmed
  output MUST remain confirmed and MUST NOT be replaced.
- **FR-052**: A failed run MUST create nothing, leave the source unchanged, and show a clear error with
  retry.
- **FR-053**: A kind MAY declare settings with a key, type, allowed values and default. A setting MUST
  resolve to the override on the edge that ran, then the kind-level value, then the declared default.
  Changes MUST be recorded with their time, MUST affect only later runs, and MUST NOT start a run. The
  Settings page MUST show a section for each kind that declares settings, generated from the
  declarations.
- **FR-054**: Nodes and edges MAY carry properties whose keys are declared by their kind or function,
  and undeclared keys MUST be rejected.

#### Carried-over features

- **FR-055**: Definitions MUST be collectable from any node's or edge's text. Each entry MUST link to
  the node or edge it came from, and following the link MUST focus that text. Terms MUST be
  underlined with hover cards on all mounted text, and duplicates MUST NOT be created (Feature 002).
- **FR-056**: Suggested underlines MUST appear on completed answer nodes only, and clicking one MUST
  select that text (Feature 005).
- **FR-057**: Information pressure and the reply model MUST remain global settings applied to every
  reply and recorded on the answer node (Feature 006).
- **FR-058**: The feedback button MUST remain global and always visible. Its context MUST record the
  project and the focused node or edge in place of the former view and node (Feature 003).
- **FR-059**: Projects, trash and restore MUST work as in Feature 004, with the canvas as the project
  view.
- **FR-060**: User text on edges MUST be shown as a user message, and answer text as plain text with
  the AI tag, preserving Feature 007's visual language. The composer MUST keep its rounded input and
  icon Send and Stop.
- **FR-061**: Every AI-produced item MUST carry ai-suggested and every user action MUST be recorded as
  user-authored or user-confirmed (Constitution Article I).
- **FR-062**: Summary generation and summary display MUST be off in v0.2. Existing summaries MUST be
  kept and no summary MUST be deleted.

#### Migration and retention

- **FR-063**: A one-time migration MUST convert all existing data to the graph and MUST be
  non-destructive: the original data MUST be retained unchanged, and a backup MUST be taken before it
  runs.
- **FR-064**: The migration MUST map each user message to a question edge and each AI message to an
  answer node, preserving exact text, order, times, reply states, and the information pressure level
  of each reply. The first user message of a root conversation MUST become the origin edge.
- **FR-065**: The migration MUST source each branch's first edge from the node or edge containing its
  anchor, preserving the anchor span and its marker; turn a branch with no messages into an unsent
  edge; turn a whole-message quick-branch marker into a quick-branch record on the original edge; and
  turn each replaced AI reply into a sibling answer node.
- **FR-066**: The migration MUST preserve definitions and their source links, parked tangents, edge
  labels as edge notes, tree positions and hand-placed node positions, feedback items and their
  context, project assignments, and trash state.
- **FR-067**: The migration MUST be repeatable without duplicating anything, and MUST report counts of
  what it converted.
- **FR-068**: All data in this feature MUST be kept between sessions, and closing and reopening the app
  MUST restore every project's canvas (Feature 001, FR-026).

### Key Entities *(include if feature involves data)*

- **Node** (replaces Feature 001's Node as the unit): a content-holding element with a kind, project,
  tree, provenance state, origin, creation time, and content. Kinds in this feature: answer and
  function output.
- **Edge** (a special kind of node): an act-holding element with a source, an optional target, a kind,
  a state, and an optional note. Kinds in this feature: question (a user message, including origin and
  quick-branch variants) and function.
- **Tree**: a connected group of nodes and edges sharing one origin edge. Different trees never share
  any.
- **Branch marker**: a record on a source node or edge pointing at an exact span, and at the edge it
  created. Feature 002's whole-message variant becomes a quick-branch record.
- **Parked tangent** (Feature 008): an anchor on a node or edge text with an optional typed question.
- **Kind and function definitions**: declarations of what a kind is and what a function does.
- **Camera and placement**: the saved camera position per project, tree placement, and hand-placed
  node positions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After migration, 100% of messages are reproduced with exact text, order and times, and
  every conversation's ordered text can be rebuilt from its path.
- **SC-002**: 100% of branch markers, definitions and their sources, parked tangents, positions,
  feedback items, and project assignments from Features 001 to 008 are present after migration.
- **SC-003**: The original data is unchanged after migration in 100% of runs, and a rerun creates 0
  duplicates.
- **SC-004**: Text is selectable and opens the toolbar at every zoom level in 100% of tested levels,
  from the furthest to the closest, for any node in view.
- **SC-005**: With at least 5,000 nodes on a project's canvas, pan and zoom stay smooth at 60 frames
  per second on the owner's machine, and the canvas opens within 1 second.
- **SC-006**: Text is mounted only for nodes and edges in the viewport plus those pinned by a
  selection, a composer, or a stream; 0 off-screen nodes hold mounted text.
- **SC-007**: A selection or composer with text survives panning away and back in 100% of cases.
- **SC-008**: In 100% of sends and walks the target is in view within 1 second, 0 camera moves happen
  from any other event, and after a manual pan 0 automatic moves occur until the next send or walk.
- **SC-009**: When a node is added to one tree, the positions of every other tree and every
  hand-placed node are unchanged in 100% of cases.
- **SC-010**: The time until the first words of a reply appear is no longer than in Feature 002 for
  95% of replies.
- **SC-011**: Retry and regenerate keep every earlier attempt and its branches in 100% of cases.
- **SC-012**: Clicking or dragging in the minimap moves the camera there within 100 milliseconds, and
  the viewport rectangle matches the real view.
- **SC-013**: A second function and a new kind can each be added by declaration alone, with 0 changes
  to the runner, verified by automated tests.
- **SC-014**: 0 function runs and 0 summary generations happen without an explicit user action or an
  existing automatic behavior from Features 001 to 008.
- **SC-015**: 100% of AI-produced nodes show as AI-generated, and 100% of user text on edges is
  recorded as user-authored.
- **SC-016**: Every automated test for definitions, feedback, projects, parking, and reply settings
  passes after being adapted to the graph where the unit changed.

## Assumptions

- **Terminology**: edges are nodes of a special kind, per the unified model. The words "node" and
  "edge" are used in this spec as defined in FR-001 for readability. Whether they share one table is
  a planning decision.
- **Feature 009 is folded in**: its draft is replaced by this feature. Its stale badge is not part of
  it, because node text never changes, so an output cannot go stale when its input changes. The badge
  returns if inputs that can change, such as summaries, return.
- **Branching from the user's own words**: the new edge's source is the edge holding the selected
  text. This is the only case where an edge is the source of an edge, and it is also how two user
  messages in a row are represented.
- **Scale**: the target is thousands of nodes (5,000 to start). Tens of thousands is a later goal. An
  early proof that 5,000 nodes in view at once, each with mounted clipped text, holds 60 frames per
  second is a planning milestone, because the selectable-text requirement is non-negotiable.
- **Rendering**: the drawn layer stays on the existing rendering and graph stack, outside the UI
  framework's render cycle. Hardware-accelerated drawing is the default; the choice of graphics
  interface is a planning concern. (Owner constraint: keep the current PixiJS and graphology stack,
  WebGL by default, WebGPU as an optional later switch.)
- **Summaries**: set aside, not removed. They may return later as a toggleable layer that also
  supports zoomed-out labels for conversations, subtrees and trees.
- **Edge notes**: Feature 002's edge labels become a separate note on an edge, because the edge's main
  text is now the user's message.
- **Side panel**: Feature 008's panel is kept, with its Branches tab listing direct child edges and its
  Parked tab unchanged in behavior.
- **Discarding parked tangents**: "no node or edge can be deleted" (FR-008) covers nodes and edges
  only. A parked tangent is neither until it is clicked, so discarding it stays an explicit user
  choice as Feature 008 defines (Constitution Article II).
- **Rejected outputs**: hidden by default means a way to show them again exists; where that control
  lives is a design decision.
- **Focus gesture**: a single click focuses a node or edge (FR-037). A drag never does.
- **Layout rules**: the exact automatic layout, including spacing, fan-out, and how a branch is placed
  relative to its anchor, is left to planning, within the requirements above.
- **Out of scope**: schemas and node types; termination of branches; coupling and typed relations;
  tree functions; every function other than Analogy; user-authored functions; the summaries layer;
  map-wide search and find-in-page; selecting across multiple nodes or edges at once (for example, a
  lasso); mobile and touch use; and history playback.
