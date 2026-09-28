# Feature Specification: Branch Queue (Parked Tangents & Branches Panel)

**Feature Branch**: `008-branch-queue-and-parking`

**Created**: 2026-09-27

**Status**: Draft

## Clarifications

### Session 2026-09-27

- Q: What are the two tabs, and what does each show? → A: "Branches," listing only the direct
  children of the currently open node, and "Parked," listing tangents flagged from the current node
  but not yet committed to a real branch (FR-001–FR-003).
- Q: How does something get parked? → A: From a text highlight, the same flow as the existing
  Define and Branch actions, with a new third option, Park, in the same selection toolbar (FR-006).
- Q: What happens when the user clicks a parked item? → A: It becomes a real branch immediately;
  there is no confirmation step (FR-012–FR-013).
- Q: What preloads into a new branch's composer? → A: An optional inline field appears at the
  moment of a Branch or Park action, where the user may type their own question. If they do, that
  text is used; if they leave it blank, the anchor text itself is used instead (FR-008–FR-010).
- Q: If a parked item has a typed question, what happens on click? → A: It fires immediately and
  automatically, exactly like the existing quick-branch ("????") mechanism from Feature 2: a real
  branch is created, the typed text is sent as its first message unchanged, an AI reply is
  requested automatically, and the user is taken straight into the branch while it arrives
  (FR-012). A parked item with no typed question instead creates the branch and preloads the
  composer with the anchor text, waiting for the user to send it themselves (FR-013).

**Depends on**: Feature 1, Branching Chat with Map View (`specs/001-branching-chat-map/`), for the
selection toolbar and branch mechanics this extends. Feature 2, Map Interactions, Definitions, and
Streaming (`specs/002-map-definitions-streaming/`), for the quick-branch ("????") behavior this
feature's auto-firing parked items mirror. This feature adds no requirement on Feature 5
(Suggested Branch Underlines, `specs/005-suggested-underlines/`) beyond the two sharing the same
selection toolbar.

**Input**: Tangents often occur faster than they can be responsibly turned into branches, and by
the time the user finishes a thought, several more have already occurred to them. This feature
adds a place to park a tangent — anchored to exactly the text that triggered it — without
committing to opening a new conversation right then, plus a lightweight way to jot down the actual
question a tangent raised so it's ready to fire the moment the user comes back to it. A panel on
the right side of the chat view holds two tabs: the node's direct branches, and its parked, not-
yet-branched tangents.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Park a tangent instead of losing it or fully committing (Priority: P1)

Mid-conversation, the user notices something worth coming back to, but doesn't want to break their
current train of thought to fully branch right now. They highlight the relevant text and choose
Park instead of Branch. Optionally, they jot a quick note of their actual question in a small field
that appears right there. The tangent is saved to the Parked tab, and the conversation continues
uninterrupted.

**Why this priority**: This is the entire point of the feature — capturing a tangent cheaply, at
the moment it occurs, is what the branch flow alone doesn't offer.

**Independent Test**: Highlight a span of text in an open conversation, choose Park, optionally
type a question into the inline field, and confirm the item appears in the Parked tab without any
new conversation or node being created.

**Acceptance Scenarios**:

1. **Given** an open conversation, **When** the user highlights a non-empty span within a single
   message and selects Park, **Then** no new node or branch is created, and an entry appears in the
   Parked tab anchored to that exact span.
2. **Given** the Park action, **When** the user takes it, **Then** an optional inline field appears
   where they may type their own question text before confirming.
3. **Given** the user types a question into that field, **When** the item is parked, **Then** both
   the anchor text and the typed question are stored with it.
4. **Given** the user leaves the inline field blank (or enters only whitespace), **When** the item
   is parked, **Then** only the anchor text is stored; no typed question is recorded.
5. **Given** a tangent has been parked, **When** the user keeps chatting in the current
   conversation, **Then** nothing about the current conversation is affected.
6. **Given** the inline field is showing, **When** the user cancels (dismisses it without
   confirming), **Then** nothing is parked and no branch is created.

---

### User Story 2 - Come back to a parked tangent and act on it in one click (Priority: P1)

Later, the user opens the Parked tab and sees the tangents they flagged earlier. They click one
that has a typed question attached, and are taken immediately into a new branch where that
question has already been sent and a reply is arriving. They click a different one that has no
typed question, and land in a new branch with the anchor text sitting in the composer, ready to
send when they are.

**Why this priority**: Capturing a tangent is only half the feature; acting on it with minimal
friction is what makes parking worth doing in the first place.

**Independent Test**: Park one tangent with a typed question and one without. Click the first and
confirm a new branch opens with that question already sent and a reply arriving. Click the second
and confirm a new branch opens with the anchor text preloaded in the composer, unsent.

**Acceptance Scenarios**:

1. **Given** a parked item that has a typed question, **When** the user clicks it, **Then** a real
   branch is created immediately, that typed text is sent as its first message unchanged, an AI
   reply is requested automatically, and the user is taken into the branch while it arrives.
2. **Given** a parked item that has no typed question, **When** the user clicks it, **Then** a real
   branch is created and its composer is preloaded with the anchor text, waiting for the user to
   send it themselves.
3. **Given** either kind of parked item is clicked, **When** the resulting branch is created,
   **Then** the item is removed from the Parked tab, the parent shows a branch marker over the
   parked span, and the new node appears in the Branches tab of its parent.
4. **Given** a parked item is clicked, **When** the underlying AI service is unreachable, **Then**
   the branch and, if applicable, its first message are still created; only the reply itself fails,
   with the standard retry handling already defined for an unreachable AI service.

---

### User Story 3 - See direct branches of the current node without leaving chat (Priority: P2)

While in a conversation, the user wants to jump to one of its existing branches without opening the
full map. They check the Branches tab and click the one they want.

**Why this priority**: This makes the panel useful even when nothing is parked, and keeps
navigation between closely related conversations lightweight. It depends on Feature 1's branch
structure already existing.

**Independent Test**: From a node with two or more direct branches, open the Branches tab, confirm
both are listed, and click one to confirm it opens that conversation.

**Acceptance Scenarios**:

1. **Given** the currently open node has direct branches, **When** the user opens the Branches
   tab, **Then** every direct child is listed, and no grandchildren or nodes from other trees
   appear.
2. **Given** the Branches tab, **When** the user clicks a listed branch, **Then** that
   conversation opens exactly as clicking it from the map would.
3. **Given** the user switches to a different node, **When** the panel is still open, **Then** both
   tabs update to reflect the newly active node's own children and parked items.

---

### User Story 4 - Edit or discard a parked tangent before acting on it (Priority: P3)

The user parked a tangent with a typed question, but on reflection wants to reword it, or decides
the tangent isn't worth pursuing after all. They edit the text, or remove the item from the Parked
tab entirely, before ever clicking it.

**Why this priority**: A parked item is a draft, not a commitment; being unable to fix or drop one
would make parking feel riskier than it needs to be. This matters less than Stories 1–3 since it's
a refinement on top of a feature that already works without it.

**Independent Test**: Park an item with a typed question, edit that question, confirm the change is
reflected, then discard a different parked item and confirm it disappears with no other item
affected.

**Acceptance Scenarios**:

1. **Given** a parked item, **When** the user edits its typed question before clicking it, **Then**
   the stored text is updated accordingly.
2. **Given** a parked item, **When** the user clears its typed question entirely, **Then** it
   behaves from then on as an item with no typed question (FR-013); **and given** an item with no
   typed question, **When** the user adds one, **Then** it behaves as an item with a typed
   question (FR-012).
3. **Given** a parked item, **When** the user discards it, **Then** it is removed from the Parked
   tab and no branch is ever created from it.
4. **Given** one parked item is edited or discarded, **When** the Parked tab is viewed, **Then** no
   other parked item is affected.

---

### Edge Cases

- **Selection overlaps an existing branch marker, a suggested underline, or a definition
  underline**: Define, Branch, and Park all remain available exactly as today; parking works the
  same regardless of what else is marking that span.
- **The same text is parked more than once, or parked and also branched directly**: each action
  creates its own independent record; nothing is deduplicated or merged, consistent with Feature
  1's existing rule that overlapping or identical anchors may have separate children.
- **A span is parked, and later the user also branches directly from the same span without ever
  clicking the parked item**: the parked item continues to exist independently until it is clicked
  or discarded; nothing merges or resolves it automatically.
- **The current node has zero direct branches and/or zero parked items**: the corresponding tab
  shows a clear empty state rather than appearing broken or identical to a populated tab.
- **Clicking a parked item with no typed question while the AI service is unreachable**: the branch
  is still created and its composer still preloaded, since this doesn't depend on the AI service
  being reachable; only sending would (separately) require it.
- **A parked item is clicked twice in quick succession**: exactly one branch is created; the item
  is consumed by the first click.
- **A parked item is clicked while a reply is still arriving in the current conversation**: the
  reply in progress is unaffected, exactly as for a quick branch started mid-reply in Feature 2.
- **The user leaves chat or reloads before the branch opens**: a parked item is either still
  parked (branch not created) or fully consumed (branch created); it is never lost without a
  branch, and never duplicated.

## Requirements *(mandatory)*

### Functional Requirements

**Panel**

- **FR-001**: The chat view MUST offer a panel on the right side of the screen with two tabs:
  "Branches" and "Parked."
- **FR-002**: The Branches tab MUST list only the direct children of the currently open node; it
  MUST NOT include grandchildren, other trees, or other projects.
- **FR-003**: The Parked tab MUST list every tangent parked from the currently open node that has
  not yet been clicked or discarded. Each entry MUST show its anchor text and, if present, its
  typed question.
- **FR-004**: Switching to a different node MUST update both tabs to reflect that node's own
  children and parked items.
- **FR-005**: An empty Branches or Parked tab MUST show a clear empty state, distinguishable from a
  populated tab.

**Parking**

- **FR-006**: The existing text-selection toolbar (Define, Branch) MUST offer a third action, Park,
  available under the same conditions as Branch (a non-empty selection within a single message).
- **FR-007**: Selecting Park MUST NOT create a node or branch; it MUST add an entry to the Parked
  tab, anchored to the exact selected span, the same way Branch anchors a real branch.
- **FR-008**: Both Branch and Park MUST offer an optional inline field, shown at the moment of the
  action, where the user may type their own question text. Confirming with the field blank MUST be
  as quick as confirming with it filled; dismissing it MUST cancel the action.
- **FR-008a**: Parked items MUST persist across reloads and sessions until clicked or discarded.

**Preloading and firing**

- **FR-009**: If the user types text into the inline field during a Branch action, the new branch's
  composer MUST be preloaded with that text; the branch is still created immediately and still
  waits for the user to send.
- **FR-010**: If the user leaves the inline field blank during a Branch action, the new branch's
  composer MUST instead be preloaded with the anchor text itself.
- **FR-011**: Every parked item MUST store its anchor text and, if provided, its typed question
  text. Whitespace-only input MUST be treated as no typed question.
- **FR-012**: Clicking a parked item that has a typed question MUST immediately create a real
  branch, send that typed text as its first message unchanged, and automatically request an AI
  reply, taking the user directly into the new branch while the reply arrives — mirroring the
  existing quick-branch ("????") behavior.
- **FR-013**: Clicking a parked item that has no typed question MUST create a real branch and
  preload its composer with the anchor text, waiting for the user to send it themselves.
- **FR-013a**: A branch created from a parked item MUST be indistinguishable from one created by
  Branch on the same span at that moment: same parent, same anchor span and branch marker, and the
  same inherited parent context as a Feature 1 highlight branch.
- **FR-014**: Once a parked item is clicked and becomes a real branch, it MUST be removed from the
  Parked tab, and the resulting node MUST appear in the Branches tab of its parent. Clicking a
  parked item MUST create at most one branch.
- **FR-015**: A parked item's typed question MUST be editable (including adding, changing, or
  clearing it), and the item itself MUST be discardable, by the user at any time before it is
  clicked, since it represents an unsent draft rather than confirmed structure.

**Non-goals**

- **FR-016**: This feature MUST NOT change the existing quick-branch ("????") mechanism, and MUST
  NOT change Branch beyond adding the optional inline field and composer preloading (FR-008–FR-010);
  branch creation, anchoring, markers, and inheritance stay as defined in Features 1 and 2.
- **FR-017**: Parking, editing, or discarding a parked item MUST NOT alter, remove, or invalidate
  any other node, branch, marker, or message (Constitution Article II).

### Key Entities *(include if feature involves data)*

- **Parked tangent**: an anchor (the source message and exact selected span) within a specific
  node, an optional user-typed question, and a creation time. Not yet a branch; may be freely edited
  or discarded before being clicked. Once clicked, it is consumed and replaced by a real node, a
  branch marker, and — if a question was typed — a sent first message, all of which then follow the
  standard immutability rules of Features 1 and 2.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From any open node, its direct branches and its parked tangents are both reachable
  without leaving chat view, in a single panel.
- **SC-002**: Clicking a parked item with a typed question produces a live branch with its first
  message already sent and a reply arriving within 2 seconds plus the reply's usual time to first
  words, the same bound as quick-branch ("????") in Feature 2 (SC-004).
- **SC-003**: Clicking a parked item with no typed question produces a live branch with its
  composer preloaded, in 100% of cases, waiting for the user's send.
- **SC-004**: Discarding or editing one parked item never affects any other parked item, branch, or
  message.
- **SC-005**: Every parked item disappears from the Parked tab exactly when it is clicked or
  discarded — never before, never after.
- **SC-006**: Parking a tangent, with or without a typed question, takes no more interactions than
  a Branch action on the same selection, and never moves the user out of the current conversation.

## Assumptions

- **Ordering**: both tabs list items newest-first for this version; manual reordering (as already
  supported for feedback items and map nodes) is not required here and is left as a possible future
  addition.
- **No automatic expiration**: parked items persist indefinitely until clicked or discarded by the
  user; there is no time-based cleanup in v1.
- **Discard as a deliberate, scoped exception**: allowing a parked item to be discarded is a
  conscious departure from the no-deletion posture that governs confirmed structure elsewhere in
  the app (Article II). It is justified because a parked item, before being clicked, is an unsent
  draft — the same status an unsent message in the composer already has, and which can already be
  freely cleared or edited. Once a parked item is clicked and becomes a real branch, standard
  immutability applies without exception, exactly as it does for any other branch. Discard is
  always an explicit user action (Article II), never a side effect.
- **Inheritance for parked branches**: because a parked item anchors a span (like Branch), not a
  whole message (like quick-branch), its branch inherits parent context exactly as a Feature 1
  highlight branch does. Feature 2's rule that a quick branch excludes the anchored message from
  inherited context does not apply, since a typed question differs from the anchor text.
- **Branches tab entries**: each entry is identified the same way the node is identified elsewhere
  (its title/summary as shown on the map); exact presentation is a design decision.
- **Panel visibility**: whether the panel can be collapsed, and its default open/closed state, are
  design decisions outside this spec, provided both tabs are reachable from chat view (SC-001).
- **Scope**: this feature applies to chat view only. The map view already shows confirmed structure
  for the whole tree and is not required to render parked, not-yet-real tangents.
- **Interplay with Feature 5** (Suggested Branch Underlines): Park is available from any
  selection shown in the toolbar, whether made manually or by clicking a suggested span; no
  additional requirement beyond the toolbar itself offering Park is needed.
- **Out of scope**: bulk-clearing parked items; parking across nodes, trees, or projects (a
  tangent is always parked from, and only visible under, the node it was created in); and any AI
  involvement in what gets parked or what question gets attached — parking and its typed question
  are always direct, user-authored actions, never AI-suggested.
