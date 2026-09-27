# Feature Specification: Branching Chat with Map View

**Feature Branch**: `001-branching-chat-map` (no git repository yet; directory name only)

**Created**: 2026-09-26

**Status**: Draft

## Clarifications

### Session 2026-09-26

- Q: What does the AI in a branch know of the parent conversation? → A: The anchor plus the parent
  conversation up to the branch point (FR-005).
- Q: Is v1 single-device without sign-in, or account-based? → A: One person, one device, no
  sign-in; data kept so accounts can be added later without converting it (FR-027).
- Q: Can users edit sent messages or regenerate AI replies? → A: No editing. The AI's latest
  reply can be regenerated only if nothing has been branched from it yet (FR-028–FR-030).
- Q: What does a branch's summary draw on? → A: Only the branch's own messages and its anchor
  text, not the inherited parent context (FR-012).
- Q: May conversation content be sent to an online AI service? → A: Yes; no special disclosure
  is required in v1 (FR-031).
- Q: Does the user see the inherited parent context in a branch? → A: Yes, read-only and visually
  set apart; whether it is collapsed or shown inline is left to design (FR-033).

**Input**: User description: "Feature Specification: Branching Chat with Map View. Users learn
continuously and want to explore tangents without losing the thread of the original
conversation, or losing the tangent itself once it's been explored. This feature lets a user
branch a new, independent conversation from any point in an existing one, and see the resulting
structure as a navigable map. This is the foundational feature of the product: every future
capability (coupling, saturation, formalization, notation) will attach to the tree structure this
feature creates. It intentionally does none of those things itself." (Full description, including
scenarios, requirements, entities, edge cases, out-of-scope list and success criteria, was
supplied with the command and is reflected below.)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start a root conversation (Priority: P1)

A user opens the app with no prior history and starts a new conversation with the AI agent. The
conversation becomes a root node: it has no parent and no anchor text. The user can start
another, unrelated root conversation at any time, and each one begins its own separate tree.

**Why this priority**: Nothing else in the product exists without a conversation to start from.
A single working root conversation is already a usable chat product.

**Independent Test**: Open the app with empty history, start a conversation, exchange several
messages, then start a second root conversation. Both exist independently and neither has a
parent.

**Acceptance Scenarios**:

1. **Given** a user with no prior history, **When** they start a new conversation and send a
   message, **Then** a root node is created with no parent and no anchor text, and the AI replies
   within that conversation.
2. **Given** a user with one or more existing trees, **When** they start a new root
   conversation, **Then** a new, separate tree is created and no existing tree is changed.

---

### User Story 2 - Branch from a highlighted fragment (Priority: P1)

A user is mid-conversation about Kubernetes Pods. The AI mentions containers in passing. The user
highlights the phrase about containers and chooses to branch. A new conversation opens, seeded
with the highlighted fragment as context. The original conversation now shows a visible marker at
the exact point the branch was made. The user can continue either conversation independently.

**Why this priority**: Branching is the core behavior of the product; every later capability
attaches to the tree it creates.

**Independent Test**: In any conversation, highlight a phrase, branch, send messages in the new
branch, return to the parent, and confirm the marker sits at the exact phrase and both
conversations continue independently.

**Acceptance Scenarios**:

1. **Given** an active conversation, **When** the user highlights a span of text and triggers
   the branch action, **Then** a new node is created whose parent is that conversation and whose
   anchor text is exactly the highlighted text.
2. **Given** a branch was just created, **When** it opens, **Then** it is a separate conversation
   seeded with the anchor text as its starting context, and the anchor text is visible to the
   user in the new conversation.
3. **Given** a branch was created, **When** the user views the parent conversation, **Then** a
   persistent marker appears at the exact location of the highlighted text and leads to the
   child conversation.
4. **Given** a parent and its branch, **When** the user sends messages in either one, **Then**
   the other conversation's messages are unchanged.
5. **Given** a node that is itself a branch, **When** the user branches from it, **Then** the
   branch works exactly as it does from a root, with no depth limit.

---

### User Story 3 - See the forest as a map (Priority: P2)

After creating several branches across one or more root conversations, the user switches to map
view. They see every root and its descendants laid out as connected trees. Each node is labeled
with a short summary of what that conversation is about now. Trees that don't share a root are
visually separate.

**Why this priority**: The map lets the user see the whole structure, which is what makes
branching worth it beyond a list of chats. It depends on Stories 1 and 2 existing first.

**Independent Test**: Create two roots, branch one of them twice and one of those branches once
more, then open map view and confirm all five nodes, the parent–child lines, the root styling,
and the two separate trees.

**Acceptance Scenarios**:

1. **Given** several trees exist, **When** the user switches from chat view to map view,
   **Then** every node in every tree is shown.
2. **Given** map view is open, **When** the user looks at any branch node, **Then** a visible
   line connects it to its parent.
3. **Given** map view is open, **When** the user compares nodes, **Then** root nodes are visually
   distinguishable from branch nodes.
4. **Given** two trees with different roots, **When** map view is shown, **Then** the trees are
   visually separate from each other.
5. **Given** map view is open, **When** the user looks at any node's label, **Then** it shows
   that node's current one-sentence summary, visibly marked as AI-generated.

---

### User Story 4 - Jump back into a conversation from the map (Priority: P2)

From map view, the user clicks a node. They go directly into that node's full conversation,
exactly where they left it, and can keep chatting or branch further.

**Why this priority**: Without this, the map is just a picture. It completes the chat → map →
chat loop.

**Independent Test**: Scroll partway up a long conversation, switch to map view, click the same
node, and confirm the conversation reopens at the same position with all messages intact. Then
click a different node and confirm it opens that conversation.

**Acceptance Scenarios**:

1. **Given** map view is open, **When** the user clicks a node, **Then** chat view opens on that
   node's full conversation.
2. **Given** the user left a conversation at a certain scroll position (and with any unsent text
   in the message box), **When** they go to map view and click back into that node, **Then** the
   conversation reopens at the same position with the same unsent text.
3. **Given** the user has returned to a conversation from the map, **When** they send a message
   or branch, **Then** it works the same as it did before they left.

---

### User Story 5 - Summaries follow the conversation as it drifts (Priority: P3)

A user branches on "leader election", but over many messages the conversation turns into a
general discussion of Raft vs. Paxos. The node's summary in map view reflects where the
conversation is now (Raft vs. Paxos), not the original anchor text, without the user relabeling
anything.

**Why this priority**: Accurate labels keep the map useful over time, but a map with slightly
stale labels is still usable, so this is less critical than Stories 1–4.

**Independent Test**: Branch on a narrow phrase, steer the conversation clearly to a different
topic over several exchanges, then open map view and confirm the summary describes the new topic.

**Acceptance Scenarios**:

1. **Given** a conversation whose topic has shifted since it was created, **When** the AI's
   latest reply finishes, **Then** the node's summary is regenerated from the full conversation
   so far and describes where the conversation now stands.
2. **Given** a summary is being regenerated, **When** the user keeps typing and sending messages,
   **Then** there is no noticeable delay in the chat view.

---

### Edge Cases

- **Selection spans an existing branch marker**: the branch is still created. The anchor text
  is exactly what was selected, whatever markers are nearby, and both markers stay visible and
  each leads to its own child.
- **Same conversation branched many times**: the parent shows a separate marker for each branch
  point, and each marker leads to its own child. Two branches may even be anchored on the same
  or overlapping text; they are still separate children.
- **Multi-level branching**: branching from a branch works exactly like branching from a root;
  there is no depth limit.
- **Empty or whitespace-only selection**: the branch action is unavailable; no node is created.
- **Selection that crosses message boundaries**: see Assumptions. By default, a branch selection
  must lie within a single message.
- **Node with no messages yet** (a fresh root or a branch before the first exchange): the map
  shows a clearly marked placeholder label (e.g. "New conversation", or the anchor text shown as
  a quotation for branches) until the first summary is generated. The placeholder is never
  styled as an AI summary.
- **Summary generation fails or is slow**: the previous summary (or placeholder) stays in place,
  chat continues unaffected, and regeneration is retried after the next completed AI reply.
- **User wants to regenerate a reply that already has a branch**: the regenerate action is
  unavailable for that reply. The user can instead branch from that point to explore a
  different answer.
- **User regenerates, then branches**: the branch is anchored in the new reply; the replaced
  reply has no markers and cannot be branched from.
- **AI reply fails mid-conversation**: the user's message and all earlier messages are kept; the
  user can retry. No node, marker or branch is lost.
- **Offline or AI service unavailable**: browsing, reading and the map keep working; sending a
  message or creating a first reply in a branch fails with a clear error and retry; summaries keep
  their last value until the service is reachable again (FR-032).
- **Very long conversation**: summaries must still reflect the full conversation. How
  regeneration avoids reprocessing the whole transcript every time is left to planning; it is not
  a requirement of this spec.

## Requirements *(mandatory)*

### Functional Requirements

**Conversations and branching**

- **FR-001**: Users MUST be able to start a new root conversation at any time, independent of any
  existing tree. A root has no parent and no anchor text.
- **FR-002**: Users MUST be able to highlight any non-empty span of text within a single message
  of the open conversation, whether written by the user or the AI, and trigger a branch action on
  that selection.
- **FR-003**: Branching MUST create a new node whose parent is the source conversation and whose
  anchor text is exactly the highlighted text.
- **FR-004**: A new branch MUST open as its own independent conversation, seeded with the anchor
  text as its starting context. The branch MUST wait for the user's first message; the AI MUST
  NOT start the branch conversation on its own.
- **FR-005**: The AI in a branch MUST have, as context, the parent conversation up to and
  including the message that contains the anchor text, plus the anchor text itself. Parent
  messages sent after the branch was created MUST NOT be visible to the branch, and nothing said in
  the branch MUST be visible to the parent. For a branch of a branch, the context is the branch's
  own parent conversation up to the branch point (which itself begins from its parent's context).
- **FR-033**: A branch MUST show the user the parent context it inherited (FR-005) along with
  the quoted anchor text, read-only and visually set apart from the branch's own messages, so the
  user can see what the AI is working from. Whether that context is collapsed by default or shown
  inline is a design decision outside this spec. Text in the inherited context cannot be branched
  from within the branch; the user branches from the parent conversation instead.
- **FR-006**: The parent conversation MUST show a persistent, visible marker at the exact
  location of the branch point. Selecting the marker MUST open the child conversation.
- **FR-007**: A conversation branched from several points MUST show a separate marker for each
  branch, each leading to its own child.
- **FR-008**: Branching from a branch MUST work exactly like branching from a root, with no depth
  limit.
- **FR-009**: Branches MUST be permanent once created. There MUST be no merge, reconciliation, or
  automatic deletion between a branch and its parent. Changes to one node's conversation MUST NOT
  change, remove, or invalidate any other node (Constitution Article II).
- **FR-010**: Messages in one conversation MUST NOT appear in, or change, any other conversation.
- **FR-028**: Sent messages (user or AI) MUST NOT be editable.
- **FR-029**: Users MUST be able to regenerate the most recent AI reply in a conversation only
  while no branch has been made from that reply. Once a branch exists in a reply, the regenerate
  action MUST be unavailable for it, so every branch marker always points at text that exists.
- **FR-030**: A regenerated reply replaces the previous one in the conversation view. The replaced
  reply MUST be kept with its creation time (not shown in v1) as part of the user's history
  (Constitution Article VI), and the node's summary MUST be regenerated afterwards.

**Summaries**

- **FR-011**: Every node MUST have a one-sentence summary generated by the AI once its
  conversation has at least one completed AI reply. Before that, the node MUST show a
  placeholder label that is not presented as an AI summary.
- **FR-012**: A node's summary MUST be regenerated as the conversation progresses, from all of
  that node's own messages available at the time (plus its anchor text, for a branch), so it
  describes where the conversation now stands rather than how it began (Constitution Article V).
  The parent context a branch inherits (FR-005) MUST NOT be used to generate the branch's summary.
- **FR-013**: Summary regeneration MUST NOT block or slow the user's ability to type, send
  messages, branch, or navigate.
- **FR-014**: Every summary MUST carry an explicit provenance state. AI-generated summaries MUST be
  in the `ai-suggested` state and MUST be visibly marked as AI-generated wherever they appear
  (Constitution Article I).
- **FR-015**: Summaries are informational labels only. They MUST NOT be presented as
  authoritative, and the system MUST keep the provenance state separate from the summary text,
  so a later feature can add a user rename (`user-authored`) or acceptance (`user-confirmed`)
  without restructuring existing data. Manual override itself is not part of this feature.
- **FR-016**: The branch structure itself (nodes, parent links, anchors, markers) is created only
  by explicit user action and MUST be recorded as `user-authored`.

**Map view**

- **FR-017**: The app MUST offer a map view that the user can switch to and from the chat view at
  any time, showing every node across every tree.
- **FR-018**: Map view MUST draw a visible line between each branch node and its parent.
- **FR-019**: Map view MUST visually distinguish root nodes from branch nodes.
- **FR-020**: Map view MUST keep trees with different roots visually separate from one another.
- **FR-021**: Each node in map view MUST be labeled with its current summary (or placeholder),
  and the label MUST update without the user refreshing or relabeling anything.
- **FR-022**: Clicking a node in map view MUST open that node's conversation in chat view, at the
  position the user last left it, with any unsent text preserved.
- **FR-023**: Adding a node to one tree MUST NOT move the nodes of any other tree in map view.

**Data retention**

- **FR-024**: The system MUST keep, for every node: its tree, its parent (if any), its anchor text
  (if any), its current summary and that summary's provenance state, and its creation time. For
  every tree, it MUST keep its root. This MUST be enough to add per-tree summaries and a
  zoom-dependent (level-of-detail) map later without converting existing data.
- **FR-025**: The system MUST record the creation time of every node, branch, and message, so
  the order in which the user built their structure is preserved for later use (Constitution
  Article VI). This feature does not display or act on that history.
- **FR-026**: All conversations, nodes, branches and markers MUST be kept between sessions;
  closing and reopening the app MUST restore the full forest.
- **FR-031**: AI replies and summaries MAY be produced by an online AI service, and the
  conversation content needed for them MAY be sent to that service. No separate disclosure to the
  user is required in v1. The saved forest itself stays on the user's device (FR-027).
- **FR-032**: When the AI service cannot be reached, users MUST still be able to open every
  conversation, view the map, and navigate between them. Sending a message MUST show a clear
  error with a retry option, and the unsent text MUST NOT be lost.
- **FR-027**: v1 is used by one person on one device with no sign-in. The forest MUST be kept
  in a form that lets accounts (and a per-account owner for each tree) be added later without
  converting existing data.

### Key Entities *(include if feature involves data)*

- **Node**: One conversation. Belongs to exactly one tree. Has at most one parent (none for a
  root), an anchor text (none for a root), a one-sentence summary with a provenance state, the
  ordered messages of the conversation, and a creation time.
- **Tree**: A connected group of nodes that share one root. Has exactly one root node. Different
  trees never share nodes.
- **Message**: One turn in a node's conversation, authored by either the user or the AI, with a
  creation time. Messages belong to exactly one node Message text never changes after it is sent. An AI
  message that was replaced by regeneration is kept but marked as replaced.
- **Branch marker**: A record in a parent node, pointing at the exact span of a specific message
  where a branch was made, and to the child node it created. A parent may have any number of
  markers.
- **Provenance state**: One of `ai-suggested`, `user-confirmed`, `user-authored`, attached to
  every AI-produced or AI-touched object (Constitution Article I). In this feature, summaries are
  always `ai-suggested`; branch structure is always `user-authored`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Starting from a single root conversation, a user can build a tree with at least
  three levels and at least five nodes using only highlight-and-branch, with no other menus or
  setup, and each branch takes no more than two actions after the text is highlighted.
- **SC-002**: In usability testing, at least 90% of first-time users successfully create a branch
  from a highlighted phrase without help.
- **SC-003**: After an AI reply finishes, the node's updated summary appears in map view within
  10 seconds in at least 95% of cases, with no manual action by the user.
- **SC-004**: While summaries regenerate, typed characters appear in the chat input with no
  noticeable delay (under 100 milliseconds) in at least 99% of keystrokes.
- **SC-005**: 100% of chat → map → chat round trips return the user to the same conversation,
  at the same position, with all messages and any unsent text intact.
- **SC-006**: With a forest of at least 500 nodes across at least 20 trees, map view opens and
  clicking any node opens its conversation within 1 second.
- **SC-007**: When a node is added to one tree, the on-screen positions of nodes in every other
  tree are unchanged in 100% of cases.
- **SC-008**: In a review of conversations whose topic clearly shifted, at least 90% of summaries
  are judged by reviewers to describe where the conversation ended up rather than its starting
  anchor, without dropping the point that made it non-obvious.
- **SC-009**: 100% of AI-generated summaries are visibly marked as AI-generated, and 0 branch
  markers, nodes or branches are lost across app restarts.

## Assumptions

- **Branch context**: A branch sees its parent's conversation only up to the branch point, so
  the parent and branch stay independent from then on (Article II). Long parent conversations may
  cost more to process; how that is handled is left to planning.
- **Users and devices**: v1 has one user on one device and no sign-in. Syncing between devices,
  sharing and backup are out of scope. If the device's data is lost, the forest is lost.
- **Branch start**: A new branch shows the anchor text as quoted context (with the inherited
  parent context, per FR-033) and waits for the user's first message, consistent with
  Constitution Article IV (user-led exploration).
- **Selection scope**: A branch selection lies within a single message. Selections across
  message boundaries are not supported in v1. Both user and AI messages can be branched from.
- **Summary timing**: Summaries regenerate after each completed AI reply. A slower cadence is
  acceptable if SC-003 is still met.
- **Summary language**: Summaries are written in the language of the conversation.
- **Navigation**: Branch markers in a parent lead to the child. A way back from a child to its
  parent (e.g. through its anchor) is provided, but the exact interaction is left to design.
- **No deletion in v1**: This feature adds no way to delete nodes or trees. Article II allows rare,
  explicit, user-chosen deletion, but that is a separate feature.
- **Map interactions**: Standard pan and zoom in map view are assumed. Level-of-detail rendering
  (tree labels vs. node labels) is out of scope.
- **Dependency**: The feature depends on an online AI conversation service that can hold
  multi-turn conversations and produce one-sentence summaries. Conversation text is sent to it;
  the saved forest is not.
- **Out of scope** (per the Constitution and v1 boundaries): coupling detection or typed edges;
  saturation, spaced review or resurfacing old nodes; compression beyond the one-sentence
  summary; formalization, derivations or notation; any AI-initiated suggestions ("ghost peaks")
  or AI-proposed branches; history playback or learning-style modeling; level-of-detail zoom
  rendering; manual summary override; accounts, sign-in and multi-device sync.
