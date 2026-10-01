# Feature Specification: Node Function Foundation

**Feature Branch**: `009-node-function-foundation`

**Created**: 2026-09-28

**Status**: Draft

## Clarifications

### Session 2026-09-28

- Q: What is the basic unit of the application? → A: The node. Everything that appears in a tree
  is a node, distinguished by its kind. Parent-child lines stay as they are today; the only new
  connector in this feature, the pipe, is itself a node (FR-001, FR-014).
- Q: What is a node function? → A: A definition that takes an input from a node and produces an
  output node. Definitions are data, and one generic runner executes any of them. Reusability and
  extensibility are hard requirements: adding a function means adding a definition, never editing
  the runner (FR-007–FR-008).
- Q: Which function ships first? → A: Analogy only. It reads a conversation node's summary and
  produces a proposed analogy node, connected to its source by a pipe (FR-010–FR-011).
- Q: Does the kind decide what happens when a node is clicked? → A: Yes. Each kind declares its own
  view. A conversation opens chat as today; an analogy opens beside its input node (FR-004,
  FR-019).
- Q: What does an unclicked analogy node show on the map? → A: The analogy derived from its input
  node's summary, carried along the pipe. It is not a summary the analogy node owns (FR-018).
- Q: Do function outputs update themselves when the source changes? → A: No. An output records
  which version of the source summary it was made from. When the source's summary version differs,
  a stale badge appears with a manual Regenerate button. Nothing regenerates automatically, so no
  tokens are spent without an explicit action (FR-020–FR-026).
- Q: What if the output was already confirmed and its source drifts? → A: The badge appears, but
  the confirmed version stays as it is. Regenerating produces a new `ai-suggested` draft beside it,
  and nothing the user vouched for is replaced without their confirmation (FR-026).
- Q: Can node kinds have their own settings? → A: Yes. Each kind declares its settings, scoped to
  that kind only. A value can be set for the whole kind, with an optional override on an individual
  node (FR-029–FR-034).
- Q: Are schemas and node types part of this feature? → A: No. Functions come first; schemas and
  type-gated functions (counter-example, falsifiable, and similar) follow once there are
  functions to gate.

**Depends on**: Feature 1, Branching Chat with Map View (`specs/001-branching-chat-map/`), whose
nodes, summaries and map this extends. Feature 2 (`specs/002-map-definitions-streaming/`) for
hand-placed positions and line selection. Feature 4 (Projects) for project boundaries. Feature 6
(`specs/006-information-pressure/`) for the existing Settings page. Feature 8's Branches panel
lists direct children only; function outputs and pipes are not children, so they do not appear
there.

**Input**: Farabi's nodes are all conversations today. The roadmap needs nodes that are something
else, such as an analogy built from another node, a counter-example, or a compressed claim, and it
needs them to be cheap to add. This feature gives every node a kind, lets a kind declare its view
and settings, and introduces node functions: reusable, data-defined operations that read from a
node and produce a new, AI-suggested node linked back to its source by a pipe. Analogy is the one
function shipped, to prove the machinery. Outputs are never regenerated automatically; a stale
badge shows when the source has moved on, and the user decides whether to spend tokens on a new
version.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Get an analogy for a node (Priority: P1)

The user is looking at a conversation node about consistent hashing and wants an analogy for it.
They choose the Analogy function on that node. An analogy node appears on the map, connected to the
source by a pipe, showing an analogy derived from the source's summary. It is marked as
AI-suggested, and nothing about the source conversation changes.

**Why this priority**: This is the whole foundation working end to end: a kind, a function
definition, the runner, an output node and a pipe.

**Independent Test**: On a conversation node that has a summary, run Analogy. Confirm an analogy
node and a pipe appear on the map in the same tree, the analogy is marked AI-suggested, and the
source conversation is unchanged.

**Acceptance Scenarios**:

1. **Given** a conversation node with a summary, **When** the user runs Analogy on it, **Then** an
   analogy node and a pipe from the source to that node are created in the same project and tree.
2. **Given** the function menu on a node, **When** it is opened, **Then** it lists only functions
   that accept that node's kind.
3. **Given** a conversation node with no summary yet (no completed AI reply), **When** the user
   looks for Analogy, **Then** it is unavailable, with the reason shown.
4. **Given** the AI service is unreachable or the run fails, **When** Analogy is attempted,
   **Then** no node or pipe is created, the source is untouched, and a clear error with retry is
   shown.
5. **Given** an analogy was produced, **When** the source conversation is inspected, **Then** its
   messages, summary and position are exactly as before.

---

### User Story 2 - See the analogy beside its input (Priority: P1)

On the map, an analogy node shows its analogy as its label. When the user clicks it, the view that
opens shows two texts next to each other: the analogy, and the node it was derived from. Clicking a
conversation node still opens chat as always.

**Why this priority**: A kind that cannot present itself differently from a conversation is not
really a different kind. This story is what makes node kinds visible.

**Independent Test**: Click an analogy node and confirm a side-by-side view opens with the analogy
and its input node. Click a conversation node and confirm chat opens as before. Click a pipe and
confirm it is selected without opening a conversation.

**Acceptance Scenarios**:

1. **Given** an analogy node on the map, **When** it is not clicked, **Then** its label shows the
   analogy derived from its input node's summary, marked as AI-generated.
2. **Given** an analogy node, **When** the user clicks it, **Then** a view opens showing the analogy
   and its input node next to each other.
3. **Given** a conversation node, **When** the user clicks it, **Then** chat view opens on that
   conversation, unchanged from Feature 1.
4. **Given** a pipe, **When** the user clicks it, **Then** it is selected and its function,
   versions and state are shown; no conversation opens.
5. **Given** a node kind with no messages, **When** it is displayed, **Then** highlight-based
   Branch, Define and Park are not offered on it.

---

### User Story 3 - Confirm or reject a proposed analogy (Priority: P2)

The analogy is a proposal. The user reads it and either confirms it, marking it as something they
vouch for, or rejects it. Rejecting does not delete anything; the record stays, it just stops
appearing on the map by default.

**Why this priority**: This is where the suggest-only principle is enforced for function outputs.
It matters less than Stories 1 and 2 because the outputs are usable before it exists.

**Independent Test**: Run Analogy twice on different nodes. Confirm one and reject the other.
Confirm the first shows as confirmed, the second disappears from the map, and both remain recorded.

**Acceptance Scenarios**:

1. **Given** a proposed analogy, **When** the user confirms it, **Then** its state becomes
   `user-confirmed` and its pipe shows as confirmed.
2. **Given** a proposed analogy, **When** the user rejects it, **Then** the rejection is recorded,
   nothing is deleted, and the analogy and its pipe stop appearing on the map by default.
3. **Given** any function output, **When** the user has not acted on it, **Then** it remains
   `ai-suggested` however long it has existed.

---

### User Story 4 - Know when an output is stale and refresh it on purpose (Priority: P2)

The source conversation drifts and its summary is regenerated as usual. The analogy that was built
from the old summary now shows a small stale badge on the map, with a Regenerate button beside it.
Nothing happens until the user presses it. If they do, a new version is added, and the old one is
kept.

**Why this priority**: It keeps outputs honest about their age without silently spending tokens. It
depends on Story 1.

**Independent Test**: Run Analogy, then steer the source conversation until its summary changes.
Confirm the badge appears and no new version was created. Press Regenerate and confirm a new
version is added with the previous one kept.

**Acceptance Scenarios**:

1. **Given** an output made from a source summary, **When** the source's summary is regenerated,
   **Then** the output shows a stale badge and a Regenerate button, and no AI call is made to
   determine this.
2. **Given** a stale output, **When** the user does nothing, **Then** it is never regenerated
   automatically.
3. **Given** a stale output, **When** the user presses Regenerate, **Then** a new version is
   created from the source's current summary, marked `ai-suggested`, and the previous version is
   kept with its time.
4. **Given** a confirmed output that has gone stale, **When** the user regenerates it, **Then** the
   new version appears as a separate `ai-suggested` draft, and the confirmed version stays in place
   until the user confirms the replacement.
5. **Given** an output whose source summary has not changed, **When** the map is shown, **Then** no
   stale badge appears.

---

### User Story 5 - Settings scoped to a kind, with per-node overrides (Priority: P3)

The user opens Settings and finds a section for Analogy, with its own options. They set a value for
all analogies. On one particular node, they override a value. The next run on that node uses the
override; every other analogy uses the kind-level value. Changing a setting never triggers a run.

**Why this priority**: It establishes the pattern every later kind will use for its own options,
but Analogy is usable with its defaults alone.

**Independent Test**: Change an Analogy setting at kind level and run it on two nodes; confirm both
use it. Override the setting on one node and run again; confirm only that node changes. Confirm no
run happened when a setting was edited.

**Acceptance Scenarios**:

1. **Given** the Settings page, **When** it is opened, **Then** it shows a section for each kind
   that declares settings, generated from those declarations.
2. **Given** a kind-level value, **When** a function runs on a node with no override, **Then** it
   uses the kind-level value.
3. **Given** a node with an override, **When** a function runs on it, **Then** it uses the override,
   and other nodes of that kind are unaffected.
4. **Given** a kind with no kind-level value set, **When** a function runs, **Then** it uses the
   default the kind declares.
5. **Given** any settings change, **When** it is saved, **Then** it is recorded with its time and
   no function runs as a result.

---

### Edge Cases

- **Existing nodes after the change**: every node from Features 1 to 8 becomes kind "conversation"
  with behavior unchanged; nothing is lost and no existing feature behaves differently.
- **Source summary changes while an analogy is being generated**: the output records the summary
  version it read when the run started, so it can show as stale immediately afterwards.
- **Running Analogy twice on the same node**: allowed. Each run produces its own analogy node and
  pipe; nothing is merged or deduplicated.
- **Source node's summary is a placeholder** (no completed AI reply yet): Analogy is unavailable
  until a real summary exists.
- **Regenerating while the AI service is unreachable**: the current version stays, the error and
  retry are shown, and no partial version is stored.
- **A rejected analogy whose source drifts**: no stale badge is shown, since it is not displayed by
  default; its record is unchanged.
- **Dragging an analogy node**: allowed like any node (Feature 2); the pipe follows it, and dragging
  never changes what the pipe connects.
- **Selecting a pipe versus a parent-child line**: both are selectable, and pipes are visibly
  distinct from parent-child lines so neither can be mistaken for a branch.
- **Function run across projects**: not possible; a function reads only its own project's nodes and
  its output lands in that project.
- **Override left on a node after the kind-level value changes**: the override still wins; the
  node's own view shows that it is overriding.

## Requirements *(mandatory)*

### Functional Requirements

**Node kinds**

- **FR-001**: Every node MUST have a kind. Every node that exists before this feature MUST become
  kind "conversation" with all existing behavior unchanged.
- **FR-002**: Kinds MUST be defined by declarations (data), each stating: its name, whether it is
  backed by a conversation, the view it opens, how its map label is produced, which settings it
  declares, and (for kinds produced by a function) which node kinds may be its inputs.
- **FR-003**: This feature MUST provide three kinds: conversation, analogy, and pipe.
- **FR-004**: Clicking a node on the map MUST open the view its kind declares. A conversation
  MUST open chat view, unchanged from Feature 1.
- **FR-005**: Kinds that are not backed by a conversation MUST have no messages, and highlight-based
  Branch, Define and Park MUST NOT be offered on them.
- **FR-006**: Feature 1's one-sentence summary and placeholder rules MUST apply to conversation
  nodes. Every other kind MUST declare its own label rule.

**Node functions**

- **FR-007**: A function MUST be defined as data, stating: an id, a version, a name, the node kinds
  it accepts, which part of the input node it reads (summary, full conversation, or anchor), the
  instruction that produces its output, the kind of node it creates, and its procedure.
- **FR-008**: One generic runner MUST execute any function definition. Adding a function MUST
  require only adding a definition, with no change to the runner.
- **FR-009**: A function MUST run only when the user explicitly starts it on a node whose kind it
  accepts. The function menu on a node MUST list only functions that accept that node's kind.
- **FR-010**: The Analogy function MUST read the input conversation node's current summary, and MUST
  be unavailable, with the reason shown, when that node has no summary yet.
- **FR-011**: A successful run MUST create an output node and a pipe from the input node to it,
  both in the input node's project and tree, both `ai-suggested`.
- **FR-012**: A failed run MUST create nothing, MUST leave the input node unchanged, and MUST show
  a clear error with a retry.
- **FR-013**: A function MUST read only nodes in its own project, and its output MUST be created in
  that same project.

**Pipes**

- **FR-014**: A pipe MUST be a node of its own kind, recording: the input node and which part of it
  is read, the output node, the function id and version, and a procedure state (proposed,
  confirmed, or rejected).
- **FR-015**: A pipe's direction MUST run from the input node to the output node and MUST NOT be
  reversible.
- **FR-016**: The map MUST draw pipes visibly differently from parent-child lines, and MUST show a
  proposed pipe as more tentative than a confirmed one.
- **FR-017**: Selecting a pipe MUST show its function, its versions, and its state. Pipes and
  function outputs MUST NOT appear as branches, and MUST NOT change any parent-child relationship.

**Views and labels**

- **FR-018**: On the map, an analogy node's label MUST be the analogy derived from its input node's
  summary, visibly marked as AI-generated.
- **FR-019**: Opening an analogy node MUST show the analogy and its input node next to each other.
- **FR-039**: An output node MUST be placed automatically near its input node within the same tree,
  without moving any other tree (Feature 1, FR-023) or any hand-placed node (Feature 2, FR-019 and
  FR-020), and MUST be draggable like any other node.

**Staleness and regeneration**

- **FR-020**: Each conversation node's summary MUST carry a version identifier that changes whenever
  the summary is regenerated.
- **FR-021**: Each function output MUST record the source summary version it was derived from.
- **FR-022**: An output MUST be treated as stale when its recorded source summary version differs
  from the source's current one. This MUST be determined without any AI call.
- **FR-023**: A stale output MUST show a stale badge on the map and in its view, with a Regenerate
  button beside it.
- **FR-024**: Outputs MUST NOT be regenerated automatically. Tokens MUST be spent on a function only
  as a result of an explicit user action.
- **FR-025**: Regenerating MUST add a new version, recorded with its time and marked `ai-suggested`;
  every earlier version MUST be kept.
- **FR-026**: If the current version has been confirmed, regenerating MUST produce a new
  `ai-suggested` draft alongside it, and the confirmed version MUST remain until the user confirms
  the replacement.

**Confirmation**

- **FR-027**: The user MUST be able to confirm a proposed output, which marks it `user-confirmed`,
  or reject it. A rejection MUST be recorded, not deleted, and a rejected output and its pipe MUST
  NOT appear on the map by default.
- **FR-028**: Every AI-produced object in this feature (analogy nodes, pipes, output versions) MUST
  carry `ai-suggested` until the user confirms it, and every user action MUST be recorded as
  `user-authored` or `user-confirmed` (Constitution Article I).

**Settings and properties**

- **FR-029**: A kind definition MAY declare settings, each with a key, a type, its allowed values,
  and a default.
- **FR-030**: A setting MUST resolve, in order, to the node's own override, then the kind-level
  value, then the kind's declared default.
- **FR-031**: The Settings page MUST show a section for each kind that declares settings, generated
  from the declarations, and the node's own view MUST allow setting or clearing its override.
- **FR-032**: Every change to a kind-level value or an override MUST be recorded with its time, and
  MUST affect only later runs. A settings change MUST NOT start a function run.
- **FR-033**: A kind's settings MUST be readable and settable only within that kind.
- **FR-034**: The Analogy kind MUST declare at least two settings: how far afield an analogy reaches
  and how long it is.
- **FR-035**: A node MUST carry a properties set whose keys are declared by its kind or function,
  and undeclared keys MUST be rejected.

**Data retention**

- **FR-036**: Every node MUST record its kind, its provenance state, its origin (user branch, quick
  branch, parked item, or a function run with the function id and version), and its creation time.
- **FR-037**: Nothing in this feature can be deleted; outputs, pipes, versions and setting changes
  are kept (Constitution Articles II and VI).
- **FR-038**: Adding kinds, pipes and outputs MUST NOT alter or invalidate any existing conversation,
  message, branch, marker, definition, or feedback item.

### Key Entities *(include if feature involves data)*

- **Node** (extends Feature 1's Node): gains a kind, a provenance state, an origin, and a declared
  properties set. Conversation-backed kinds keep messages; other kinds have none.
- **Node kind definition**: a declaration of a kind's name, conversation backing, view, label rule,
  settings, and accepted input kinds.
- **Function definition**: a versioned declaration of one function: accepted kinds, part of the
  input read, instruction, output kind, and procedure.
- **Pipe** (a kind of node): the directed link from an input node to an output node, with the
  function id and version and a procedure state.
- **Function output version**: one generated text for an output node, with the source summary
  version it was made from, its state, and its time; the latest is current.
- **Setting declaration and override**: a kind's declared setting, its kind-level value, and any
  per-node override, each with the time of its last change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of existing nodes become kind "conversation" after the change, and every
  automated test from Features 1 to 8 still passes.
- **SC-002**: After Analogy is run on a node with a summary, the analogy node and pipe appear on the
  map without a reload, within 10 seconds in at least 95% of runs.
- **SC-003**: Across a session of edits, summary regenerations and setting changes, 0 function runs
  happen without an explicit user action.
- **SC-004**: 100% of outputs whose source summary version changed show a stale badge, and 0 AI
  calls are made to determine it.
- **SC-005**: A confirmed output version is never replaced without the user confirming the
  replacement, in 100% of cases.
- **SC-006**: A second function can be added by writing its definition alone, with 0 changes to the
  runner, verified by an automated test that registers a test-only definition.
- **SC-007**: A new kind with its own view and settings can be added by declaration alone, and its
  settings section appears on the Settings page with no page edit.
- **SC-008**: A setting resolves correctly across override, kind-level and default in 100% of
  cases, and 0 setting changes start a run.
- **SC-009**: With at least 500 conversation nodes plus function outputs, the map opens and clicking
  a node opens its view within 1 second, meeting Feature 1's target.
- **SC-010**: 100% of AI-produced outputs are shown as AI-suggested until the user confirms them.

## Assumptions

- **Analogy output is text, not a conversation**: in this feature an analogy node holds its
  versioned text and cannot be turned into a conversation. Letting a function output collapse into a
  conversation is left for a later feature; kind declarations leave room for it.
- **Input side of the side-by-side view**: the input node is shown as its conversation, read-only,
  with a way to open it normally. Showing only its summary is the fallback if that proves too heavy.
- **Rejected outputs**: recorded and hidden from the map by default; how to view them again is left
  to planning.
- **Feature 6's settings stay as they are**: information pressure and the reply model remain global
  settings on the existing Settings page. Folding them into the Conversation kind's declarations is
  a later alignment, not part of this feature.
- **Analogy settings**: the two declared settings (reach and length) use bounded choices; the exact
  value sets and defaults are left to planning.
- **Where the function menu lives**: reachable from a selected node on the map and from a node's own
  view; exact placement is a design decision.
- **Function instructions**: the wording of the Analogy instruction is a planning concern; this
  spec constrains its inputs, outputs, and provenance.
- **Article III**: an analogy is AI-supplied material and is always presented as such, never as the
  user's own.
- **Out of scope**: schemas and node types; type-gated functions; tree functions, including the idea
  of a "run on new nodes" action for outputs that do not exist yet; every function other than
  Analogy; user-authored functions; edges-as-nodes beyond the pipe; editing an output's text; running
  a function on another function's output; and layout bias by schema.
