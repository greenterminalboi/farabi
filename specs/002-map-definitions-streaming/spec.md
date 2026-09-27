# Feature Specification: Map Interactions, Definitions, and Streaming

**Feature Branch**: `002-map-definitions-streaming`

**Created**: 2026-09-27

**Status**: Draft

## Clarifications

### Session 2026-09-27

- Q: What should a definition draft explain? → A: Both, kept short: a general definition plus how
  the term is used in the source conversation (FR-029). Definitions are an early concept to build
  on later.
- Q: While a reply is streaming, can the user stop it partway? → A: Yes; a Stop button keeps the
  partial text, marked stopped, and it can be retried (FR-003a).
- Q: Must the user press Send after typing `????`? → A: No; typing exactly `????` in the message
  box triggers the quick branch at once when one is possible (FR-006a).
- Q: Should collected terms be marked in conversation text? → A: Every occurrence of a collected
  term in every conversation is marked, and hovering a mark shows that term's definition card
  (FR-036a–FR-036c).

**Depends on**: Feature 1, Branching Chat with Map View (`specs/001-branching-chat-map/`). This
feature extends Feature 1's data and map; it replaces none of it.

**Input**: User description: "Feature Specification: Map Interactions, Definitions, and
Streaming. Feature 1 produced a map that is accurate but passive. Feature 2 makes the map a
workspace: nodes and trees can be repositioned by hand, edges can carry a meaning you write
yourself, a running glossary of terms builds up as you read, replies arrive as they're generated
rather than all at once, and a lighter branching gesture ('????') lowers the friction of forking a
new thread when precise highlighting isn't the point." (Full description, including scenarios,
requirements, entities, edge cases, confirmed decisions, out-of-scope list and success criteria,
was supplied with the command and is reflected below.)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Watch a reply arrive (Priority: P1)

A user sends a message. Instead of waiting in silence, the reply appears progressively as it is
generated, as in mainstream chat products. If the reply is cut off partway (network failure,
service error, usage limit), the text received so far stays visible, clearly marked as
incomplete, and the user can retry.

**Why this priority**: Every conversation and both branching gestures depend on replies. Waiting
several seconds in silence for each one is the largest day-to-day friction left from Feature 1.

**Independent Test**: Send a question that needs a long answer. Text starts appearing well before
the answer is finished. Interrupt a reply partway; the partial text remains, marked incomplete,
with a Retry action.

**Acceptance Scenarios**:

1. **Given** an open conversation, **When** the user sends a message whose reply takes more than
   2 seconds to finish, **Then** the first words of the reply appear before it finishes and the
   rest fills in progressively.
2. **Given** a reply is arriving, **When** the connection or the AI service fails partway,
   **Then** the text received so far is kept, marked as incomplete, and a Retry action is offered.
3. **Given** an incomplete reply, **When** the user retries, **Then** a new reply attempt is
   produced; the incomplete text is kept in history and never edited.
4. **Given** a reply is arriving, **When** the user presses Stop, **Then** the reply stops, the
   text so far is kept and marked as stopped, and Retry is offered.
5. **Given** a reply is arriving, **When** the user switches to the map or another conversation
   and back, **Then** the reply continues or shows its final state, with no text lost.

---

### User Story 2 - Branch without highlighting using "????" (Priority: P1)

A user writes a message and then realises it deserves its own thread. They send exactly `????`.
The `????` is not sent to the AI. Instead, the user's own previous message becomes the anchor of a
new branch of the current conversation. That same text is sent again as the new branch's first
message, and the user lands in the new branch with the reply already arriving.

**Why this priority**: It is a second way to grow the tree, and growth of the tree is the core of
the product. It needs no precise text selection, so it removes friction from the most frequent
action.

**Independent Test**: In a conversation, send a message, then send `????`. A new branch opens
with that message as its first message and a reply arriving. The parent shows a branch marker on
the original message. The AI never receives `????`.

**Acceptance Scenarios**:

1. **Given** a conversation with at least one message written by the user, **When** the user
   sends exactly `????`, **Then** a new branch is created whose parent is the current
   conversation, anchored to the full text of the user's most recent message.
2. **Given** that branch was just created, **When** it opens, **Then** its first message is the
   anchored text (sent again, unchanged), an AI reply is requested automatically, and the user is
   taken into the branch while the reply arrives.
3. **Given** the branch was created, **When** the user returns to the parent, **Then** the
   anchored message shows a branch marker covering the whole message, which leads to the branch,
   and no `????` message appears in the parent.
4. **Given** the user's most recent message already has an AI reply, **When** they send `????`,
   **Then** the branch is still anchored to that user message.
5. **Given** a conversation with no message written by the user, **When** the user sends `????`,
   **Then** it is sent as an ordinary message.
6. **Given** a message that contains `????` alongside other text (for example "does this mean
   ????"), **When** it is sent, **Then** it is an ordinary message and no branch is created.

---

### User Story 3 - Rearrange the map by hand (Priority: P2)

A user finds two related trees far apart, so they drag one tree closer to the other. Later they
drag a single node to a place that better matches how they think about it. Both positions are
kept across sessions, and neither drag changes the tree's structure.

**Why this priority**: It turns the map from a picture into a workspace, but the map is already
usable without it.

**Independent Test**: Drag a whole tree and, separately, one node in another tree. Reload the
app; both positions are unchanged. Every parent–child line is still drawn between the same nodes.

**Acceptance Scenarios**:

1. **Given** the map, **When** the user drags a tree, **Then** the whole tree moves with the
   pointer, including any nodes placed by hand, and stays at its new position after a reload.
2. **Given** the map, **When** the user drags one node, **Then** only that node moves, its lines
   to its parent and children follow it, and it stays at its new position after a reload.
3. **Given** a node placed by hand, **When** new branches are added to its tree, **Then** that
   node stays where the user put it, and nodes that were never placed by hand are laid out
   automatically as before.
4. **Given** any drag, **When** it ends, **Then** every node keeps the same parent and children
   (no drag can detach, attach or re-parent a node).
5. **Given** a tree the user has placed, **When** another tree grows near it, **Then** the
   user-placed tree is never moved automatically.

---

### User Story 4 - Build a glossary while reading (Priority: P2)

Mid-conversation, the AI uses the term "control plane". The user highlights it and sends it to
their definitions. The AI drafts a short definition, which appears in a Definitions tab marked as
a draft. Later, the user reads the draft and edits it into their own words. It is then marked as
confirmed.

**Why this priority**: It adds a new way of keeping what the user learns, but it is independent of
the conversation and map flows.

**Independent Test**: Highlight a term in a reply and send it to Definitions. A short drafted
definition (general meaning, then how the term is used in that conversation) appears in the Definitions tab, marked as a draft, with a link back to where it came from. Edit
it; it is marked confirmed. Send the same term again from another conversation; no duplicate is
created and the existing entry is shown.

**Acceptance Scenarios**:

1. **Given** a completed message, **When** the user highlights a word or short phrase and chooses
   to send it to Definitions, **Then** an entry for that term is created and an AI-drafted
   definition is added to it, marked as a draft (`ai-suggested`).
2. **Given** the Definitions tab, **When** the user opens it, **Then** every collected term is
   listed with its current definition and whether it is a draft or confirmed.
3. **Given** a collected term, **When** it appears in any conversation, **Then** each occurrence
   is underlined, and hovering one shows the term's definition card with its state.
4. **Given** a draft definition, **When** the user edits its text and saves, **Then** the
   definition shows the new text and is marked confirmed (`user-confirmed`).
5. **Given** a draft definition, **When** the user confirms it without editing, **Then** it is
   marked confirmed with its text unchanged.
6. **Given** any entry, **When** the user follows its source link, **Then** the conversation it
   was captured from opens at the message it came from.
7. **Given** a term already in Definitions, **When** the user sends the same term again from any
   conversation, **Then** no new entry is created and the existing entry is shown to the user.

---

### User Story 5 - Label a relationship on the map (Priority: P3)

A user has branched "Pods" from "Containers". On the map, they select the line between the two
nodes and type "requires understanding of". The label is shown on that line whenever the map is
viewed, and they can change or clear it later.

**Why this priority**: The affordance is deliberately minimal and is put in place ahead of need.

**Independent Test**: Select any line on the map, type a label and save it. Reload; the label is
drawn beside the line. Edit it, then clear it.

**Acceptance Scenarios**:

1. **Given** the map, **When** the user selects a parent–child line and enters text, **Then** the
   label is saved and drawn next to that line.
2. **Given** a labelled line, **When** the map is opened later, **Then** the label is visible
   without selecting the line.
3. **Given** a labelled line, **When** the user edits or clears the label, **Then** the map shows
   the new text or no label.

---

### Edge Cases

- **Term marks overlapping branch markers**: both are shown; the underline sits under the branch
  highlight, and each stays usable.
- **One term inside another** ("control plane" and "plane" both collected): the longer match wins
  where they overlap; elsewhere "plane" is marked on its own.
- **Dragging onto other nodes or trees**: allowed. Overlap is the user's choice and is not
  prevented or corrected.
- **Dragging a tree that was never placed before**: the drag sets its position for the first
  time, the same as for a tree already placed.
- **Clicking vs dragging**: a click on a node still opens its conversation (Feature 1). Only
  movement beyond a small threshold counts as a drag, and a drag never opens a conversation.
- **Multi-word or unusual terms**: any highlighted word or short phrase can be sent to
  Definitions; there is no single-word restriction.
- **Same term, different capitalisation or spacing**: "Control Plane", "control plane" and
  "control  plane" are the same entry (see Assumptions).
- **Same term from two conversations**: one entry. It keeps the source where it was first
  captured.
- **Definition draft fails** (AI unavailable or usage limit): the entry is still created with no
  definition yet and a Retry action; the term is not lost.
- **`????` twice in a row** (no new user message in between): the second `????` falls back to an
  ordinary message, per FR-022, rather than branching the same anchor again.
- **`????` while a reply is still arriving**: the reply in progress is unaffected. The branch is
  created from the user's most recent message, and the current conversation keeps its reply.
- **Stream interrupted mid-word**: the partial text is shown as received; no buffering to word
  boundaries.
- **Incomplete and stopped replies as anchors**: an incomplete or stopped reply cannot be branched from or used to
  capture a definition (see Assumptions).

## Requirements *(mandatory)*

### Functional Requirements

**Streaming**

- **FR-001**: AI replies MUST appear in the chat view progressively while they are generated, not
  only once complete.
- **FR-002**: The first part of a reply MUST appear no later than a complete reply of the same
  length would have appeared under Feature 1.
- **FR-003**: If a reply stops before completing, the text received so far MUST be kept, shown as
  incomplete, and offered for retry. A retry MUST create a new reply attempt; the incomplete text
  MUST be kept in history and MUST NOT be edited (Feature 1: sent text never changes).
- **FR-003a**: While a reply is arriving, the user MUST be able to stop it. The text received so
  far MUST be kept, marked as stopped by the user (distinct from interrupted by an error), and
  offered for retry exactly like an incomplete reply (FR-003).
- **FR-004**: A reply MUST continue arriving, and its final text MUST be stored, even if the user
  navigates to the map or another conversation while it arrives.
- **FR-005**: The conversation label (Feature 1 summaries) MUST be based only on completed replies.

**Quick branch ("????")**

- **FR-006**: A message consisting of exactly `????` (ignoring surrounding whitespace) MUST NOT be
  sent to the AI when a quick branch is possible (FR-007).
- **FR-006a**: When the message box contains exactly `????` and a quick branch is possible
  (FR-007, FR-012), the quick branch MUST start immediately, without pressing Send. When no quick
  branch is possible, `????` stays in the box and is sent only if the user sends it.
- **FR-007**: The system MUST find the user's own most recent message in the current conversation,
  whether or not it has an AI reply, and create a new branch whose parent is the current
  conversation and whose anchor is that message's full text.
- **FR-008**: The parent MUST show a branch marker covering the whole anchored message, leading to
  the new branch. No `????` message is stored in or shown in the parent.
- **FR-009**: The new branch MUST start with the anchored text sent again, unchanged, as its first
  message (user-authored), and an AI reply MUST be requested automatically.
- **FR-010**: The user MUST be taken straight into the new branch, where the reply arrives per
  FR-001.
- **FR-011**: The new branch MUST inherit the parent conversation up to, but not including, the
  anchored message, because that message is the branch's own first message (FR-009) and would
  otherwise appear twice. Otherwise inheritance works as for a Feature 1 branch.
- **FR-012**: If the current conversation has no user message, or its most recent user message
  has already been used as a quick-branch anchor, `????` MUST be handled as an ordinary message.
- **FR-013**: A message containing `????` alongside any other text MUST be handled as an ordinary
  message.
- **FR-014**: Highlight-based branching from Feature 1 MUST keep working unchanged.

**Drag-and-drop**

- **FR-015**: Users MUST be able to drag a whole tree to a new position on the map; the position
  MUST persist across sessions.
- **FR-016**: Users MUST be able to drag an individual node to a new position; that position MUST
  replace its automatically computed position and MUST persist across sessions.
- **FR-017**: A node's hand-placed position MUST be relative to its tree, so moving the tree moves
  every node in it, including hand-placed ones.
- **FR-018**: Dragging MUST never change any parent–child relationship. No interaction in this
  feature can detach, attach or re-parent a node.
- **FR-019**: Nodes never placed by hand MUST keep their automatic layout, including when the
  tree is laid out again after new branches are added.
- **FR-020**: A tree the user has dragged MUST never be moved automatically. Feature 1's automatic
  relocation of a growing tree applies only to trees the user has never placed.
- **FR-021**: The dragged element MUST follow the pointer without visible lag while dragging.
  Saving the new position MUST NOT slow the drag.
- **FR-022**: Clicking a node without dragging MUST still open its conversation (Feature 1).

**Edge labels**

- **FR-023**: Users MUST be able to select any parent–child line on the map and attach a free-text
  label to it; each line has at most one label.
- **FR-024**: A label MUST be drawn beside its line whenever the map is shown at a zoom level where
  labels are legible, without selecting the line.
- **FR-025**: Users MUST be able to edit or clear a label at any time. Clearing a label removes it
  from the map; the change is recorded, not silently discarded (Article VI).
- **FR-026**: Edge labels are always `user-authored`. The AI does not propose, suggest or edit
  them in this feature.

**Definitions**

- **FR-027**: Users MUST be able to highlight a word or short phrase in any completed message and
  send it to Definitions, from the same selection that offers branching.
- **FR-028**: Sending a new term MUST create an entry and request an AI-drafted definition, stored
  as `ai-suggested` and shown as a draft.
- **FR-029**: The AI's draft MUST have two short, clearly separated parts: a general definition
  of the term (at most two sentences), and how the term is used in the conversation it was
  captured from (one sentence, grounded in that message and its conversation). The general part
  MUST be presented as a general definition, never as something drawn from the user's own
  material (Article III).
- **FR-030**: A Definitions tab MUST be reachable at all times, separate from the chat and map
  views.
- **FR-031**: The tab MUST list every entry with its term, its current definition and its state
  (draft `ai-suggested` or confirmed `user-confirmed`).
- **FR-032**: Users MUST be able to edit an entry's definition. Saving an edit MUST mark it
  `user-confirmed`. Users MUST also be able to confirm a draft without editing it.
- **FR-033**: Every entry MUST keep a link to the conversation and message it was captured from,
  and following it MUST open that message (Article V).
- **FR-034**: Sending a term that already has an entry MUST NOT create a duplicate; the existing
  entry MUST be shown to the user.
- **FR-035**: Every version of a definition (the AI draft and each user edit) MUST be kept with its
  time and state; the tab shows the latest (Article VI).
- **FR-036**: If drafting fails, the entry MUST still be created, shown as having no definition
  yet, and offer a retry.
- **FR-036a**: Every occurrence of a collected term in every conversation's messages (including the
  inherited context shown in branches) MUST be marked with a subtle underline, visually distinct
  from branch markers. Matching uses the same rule as duplicate detection (Assumptions: term
  matching) and whole words only, so "pod" does not match inside "podcast".
- **FR-036b**: Hovering (or focusing) a marked term MUST show its definition card: the term, its
  current definition (general part and in-conversation part), and whether it is a draft or
  confirmed. The card MUST link to the entry in the Definitions tab.
- **FR-036c**: Marks MUST appear as soon as a term is collected, including while its draft is still
  being written (the card then says the definition is being drafted), and MUST NOT stop the text
  from being selected for branching or for Definitions.
- **FR-037**: No definitions, edge labels or hand-placed positions can be deleted in this feature
  (Article II).

**Unchanged from Feature 1**

- **FR-038**: Every AI-produced item in this feature (replies, definition drafts) MUST carry the
  `ai-suggested` state; every user action (drags, labels, quick-branch structure, edits) MUST be
  recorded as `user-authored` or `user-confirmed` as defined above (Article I).

### Key Entities *(include if feature involves data)*

- **Hand-placed node position** (extends Node): an optional position chosen by the user, relative
  to the node's tree. Absent until the node is first dragged; when present it replaces the
  automatic position.
- **Tree placement** (extends Tree): Feature 1's saved tree position, plus whether the user has
  placed the tree by hand (which stops automatic relocation).
- **Edge label**: text attached to one parent–child line, always `user-authored`, with its
  history of changes and times.
- **Definition entry**: one per distinct term (normalised as in Assumptions), with the term as
  first captured, a link to its source conversation and message, and its current state.
- **Definition version**: one text of a definition entry, with its state (`ai-suggested` for the AI
  draft, `user-confirmed` for an accepted or edited one) and time; the latest is current.
- **Whole-message branch marker** (extends Feature 1's Branch marker): a marker covering the entire
  text of a user-written message, created by `????`. Feature 1's markers cover a highlighted span
  and can sit on user or AI messages; this variant always covers a whole user message.
- **Reply state** (extends Message): replies can now be in progress, incomplete (interrupted by an
  error) or stopped (by the user), in addition to Feature 1's complete and failed states.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For replies that take more than 2 seconds to finish, text starts appearing within
  the time the first part of the reply is available, and in 95% of cases at least 1 second before
  the reply finishes.
- **SC-002**: The time until the first words of a reply appear is no longer than Feature 1's time
  until a complete reply of the same length appeared, for 95% of replies.
- **SC-003**: In 100% of interrupted replies, the text received before the interruption is still
  visible afterwards and after a reload, marked as incomplete.
- **SC-004**: Sending `????` after a user message produces a new branch, with the resent message
  and a reply arriving, within 2 seconds plus the reply's usual time to first words; `????`
  reaches the AI in 0% of those cases.
- **SC-005**: After rearranging at least one tree and one individual node, 100% of positions are
  unchanged after closing and reopening the app, and 100% of parent–child lines connect the same
  nodes as before.
- **SC-006**: While dragging, the dragged element stays under the pointer with no visible lag
  (under one screen refresh of delay) at 500 nodes.
- **SC-007**: A labelled line shows its label on the map without further clicks in 100% of cases.
- **SC-008**: A user can collect at least 20 terms across several conversations; every term
  appears exactly once in the Definitions tab, and repeated captures create 0 duplicates.
- **SC-009**: With 500 entries, the Definitions tab opens within 1 second and scrolls without
  visible stutter.
- **SC-009a**: With 500 collected terms, opening a conversation still meets Feature 1's
  navigation target (under 1 second), and a definition card appears within 300 milliseconds of
  hovering a marked term.
- **SC-010**: 100% of AI drafts are shown as drafts until the user confirms or edits them, and
  100% of entries link back to the message they were captured from.

## Assumptions

- **Term matching**: two terms are the same entry when they match after trimming, collapsing
  repeated spaces and ignoring letter case. The entry shows the term as first captured.
- **Source for repeated terms**: an entry keeps the conversation and message where it was first
  captured.
- **Confirming without editing**: the tab offers a "Confirm" action on drafts, since
  `user-confirmed` means an AI proposal the user accepted (Constitution Article I).
- **Order of the Definitions tab**: newest entries first, with a simple text filter to find a
  term among hundreds.
- **Where "Send to definitions" appears**: next to the existing Branch action when text is
  highlighted in a completed message.
- **Incomplete and stopped replies**: like pending and failed ones, they cannot anchor a branch or a
  definition; only completed messages can.
- **Drag threshold**: pointer movement of a few pixels separates a click (open conversation) from
  a drag.
- **Selecting a line**: the clickable area around a line is wider than the drawn line, so thin
  lines are easy to select.
- **Edge label length**: labels are short phrases; very long labels are shortened on the map and
  shown in full when selected.
- **Streaming with every AI setup**: progressive replies apply with both the subscription-based and
  the API-based AI setups from Feature 1; the automated test setup simulates them.
- **Out of scope** (per the input and the Constitution): AI-suggested or detected edge labels;
  structure beyond a flat definitions list; deleting definitions, labels or hand-placed
  positions; any change to root conversations or highlight branching; limits on definition
  drafting and per-card presentation (planned); notation, formalization and coupling.
