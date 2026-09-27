# Feature Specification: Suggested Branch Underlines

**Feature Branch**: `005-suggested-underlines`

**Created**: 2026-09-27

**Status**: Draft

## Clarifications

### Session 2026-09-27

- Q: Does a suggested span create any stored data? → A: Nothing about a suggestion is recorded in
  the user's structure, because nothing has happened yet; only a click turns a suggestion into a
  real action (FR-006). A hidden cache of computed spans is allowed (FR-013).
- Q: What does clicking a suggested span do? → A: It becomes the user's active text selection,
  exactly as if they had dragged over that text by hand. The existing selection toolbar (Define,
  Branch) then appears; no new action is introduced (FR-004–FR-005).
- Q: What color and style should suggested spans use? → A: A grey dotted underline, deliberately
  the quietest of the app's three underline meanings, so it reads as unconfirmed (FR-002).
- Q: Does this apply to the user's own messages? → A: No, AI replies only, for this version
  (FR-007).
- Q: Does this only cover list items? → A: No. It covers any span of a completed AI reply the
  system identifies as independently worth exploring, not just literal list syntax; the exact
  detection method is left to planning (see Assumptions).
- Q: Should suggestions be on or off by default (Article IV)? → A: On by default, with a setting
  to turn them off (FR-012).
- Q: May computed spans be cached so a message isn't re-analyzed on every view? → A: Yes, as a
  hidden cache that is never part of the user's structure or history (FR-006, FR-013).
- Q: Can several spans be branched into new nodes at once? → A: No. Batch or bulk branching from
  multiple suggested spans is explicitly out of scope for this feature.

**Depends on**: Feature 1, Branching Chat with Map View (`specs/001-branching-chat-map/`), for the
highlight-to-branch flow and its selection toolbar, which this feature feeds into rather than
replaces. Feature 2's reply states (`specs/002-map-definitions-streaming/`) govern when a reply
counts as complete.

**Input**: Replies can contain several ideas worth exploring separately, and today the user has to
notice that themselves and manually drag-select each one to branch from it. This feature has the
app do the noticing: after an AI reply finishes, spans of its text that look independently
explorable are marked with a subtle grey dotted underline. Clicking one selects that exact text,
which hands off to the existing Define/Branch toolbar unchanged. The AI never creates a branch, a
node, or any stored object by doing this; it only makes something the user could already do
easier to notice.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Notice a branch-worthy span without hunting for it (Priority: P1)

An AI reply finishes. Within it, a few spans of text are quietly underlined with a grey dotted
line. The user notices one that looks interesting and clicks it. The span becomes selected, the
same toolbar that would appear from a manual drag-select pops up, and the user branches from it
exactly as they would have anyway, just without having to find and drag over the text themselves.

**Why this priority**: This is the entire feature. Without it, there's nothing else to build.

**Independent Test**: Send a message that produces a reply containing several distinct ideas.
Confirm some spans show a grey dotted underline once the reply completes. Click one and confirm it
becomes the active selection with the Define/Branch toolbar showing, identical to a manual
drag-select of that same span.

**Acceptance Scenarios**:

1. **Given** an AI reply has fully finished, **When** the app identifies a span of its text as
   branch-worthy, **Then** that span is shown with a grey dotted underline.
2. **Given** a reply is still streaming, **When** the user looks at it, **Then** no suggested
   underlines are shown; they can only appear once the reply is complete.
3. **Given** a suggested span, **When** the user clicks it, **Then** that exact text becomes the
   active selection, identical in effect to manually dragging over it.
4. **Given** a suggested span has just been clicked, **When** the selection is made, **Then** the
   existing selection toolbar (Define, Branch) appears, and everything from there behaves exactly
   as Feature 1 and Feature 2 already specify.
5. **Given** a suggested span was never clicked, **When** the conversation is inspected later,
   **Then** no record of that span exists in the conversation, the map or its history.
6. **Given** suggested spans are showing, **When** the user drags to select any other text by hand,
   **Then** manual selection works exactly as before; suggestions never block or replace it.

---

### User Story 2 - Suggested spans stay out of the way of confirmed structure (Priority: P2)

A reply has a span that's both underlined as a suggestion and covered by a confirmed branch marker
(because the user already branched from part of it) or a definition underline (because a term in
it was already collected). The user can still tell all three apart and interact with each
correctly.

**Why this priority**: Without a clear visual hierarchy, three kinds of underlines competing for
the same text makes the chat harder to read, undermining the point of the feature.

**Independent Test**: Branch from a span, then reload the same reply and confirm a suggested
underline can still appear elsewhere in the same message without visually competing with the
confirmed marker. Collect a definition term inside a suggested span and confirm both remain
individually recognizable and clickable for their own purpose.

**Acceptance Scenarios**:

1. **Given** a reply containing both a confirmed branch marker and a suggested span, **When** the
   user views it, **Then** the two are visually distinguishable, with the suggested span reading as
   the less certain of the two.
2. **Given** a definition-collected term falls inside a suggested span, **When** the user views the
   message, **Then** both the definition underline and the suggested underline remain individually
   visible, and clicking the term does what a definition underline does while clicking elsewhere
   in the span selects the span.
3. **Given** a message with several suggested spans, **When** the user views it, **Then** no more
   than the per-message cap is shown (see Assumptions).

---

### Edge Cases

- **Reply stopped, incomplete or failed**: no suggested spans are computed or shown; a span
  requires a fully completed reply, consistent with Feature 2's rule that only completed messages
  can anchor a branch or a definition.
- **Reply is retried**: the earlier attempt keeps no suggestions (it is not complete); the new
  reply gets its own spans once it completes.
- **A reply with no clear candidate spans**: no suggested underlines are shown; nothing is forced
  onto a reply that doesn't have anything worth flagging.
- **Overlapping suggested spans**: resolution (merge, prioritize, or avoid overlap in detection) is
  left to planning; the visible result never shows two suggested underlines on the same text.
- **A suggested span overlapping a confirmed branch marker exactly**: clicking selects the
  suggested span's own text; this does not alter, extend, or interact with the existing marker.
- **Revisiting an old conversation**: the same message shows the same suggested spans every time it
  is viewed, with no dependency on when it was last opened.
- **Detection unavailable**: if suggestions cannot be produced for a message (for example the AI
  setup is unreachable), the message simply shows none; no error is shown and nothing else about
  the message changes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST identify candidate spans within a completed AI reply that could be
  independently worth branching from, using only that reply's own text (Article III).
- **FR-002**: Identified spans MUST be rendered with a grey dotted underline, visually distinct
  from, and quieter than, Feature 1's confirmed branch markers and Feature 2's definition-term
  underlines. This rendering is how a suggestion shows its `ai-suggested` nature (Article I).
- **FR-003**: Suggested spans MUST NOT be computed or displayed for a reply until that reply has
  fully completed; a reply that is pending, streaming, incomplete, stopped or failed MUST show no
  suggested underlines.
- **FR-004**: Clicking a suggested span MUST set that exact text as the user's active selection,
  with the same effect as manually selecting it by hand.
- **FR-005**: Once a suggested span becomes the active selection, the existing selection toolbar
  (Define, Branch) MUST appear; this feature introduces no new action beyond that hand-off.
- **FR-006**: Suggested spans MUST NOT be recorded as part of the user's structure: no node,
  marker, definition, history entry or provenance record is created for a span that is shown,
  whether or not it is clicked. Anything the user then does via the toolbar is recorded exactly as
  Feature 1 and Feature 2 already specify.
- **FR-007**: Suggested spans apply only to AI-authored messages in this version; the user's own
  messages MUST NOT show suggested underlines.
- **FR-008**: No message MUST show more suggested spans than the per-message cap (see Assumptions).
- **FR-009**: Suggested spans MUST NOT alter the underlying message text and MUST NOT create any
  node, branch, marker, or other structural object on their own; only a subsequent user action
  (via the existing Feature 1/2 flow) can do that.
- **FR-010**: Suggested spans MUST NOT hide, restyle or intercept a confirmed branch marker or a
  definition underline; each keeps its own look and its own click behavior.
- **FR-011**: Suggested spans MUST NOT block, delay or replace manual text selection anywhere in a
  message (Article IV).
- **FR-012**: The user MUST be able to turn suggested underlines off and on again with a single
  setting. Suggestions are on by default; turning them off hides them on every message at once
  (Article IV).
- **FR-013**: A given completed message MUST show the same suggested spans each time it is viewed.
  The spans computed for a message MAY be kept in a hidden cache so they are not recomputed on
  every view; that cache is never part of the conversation, the map, definitions or history,
  nothing may read it except to redraw the underlines, and removing it loses nothing the user
  created.

### Key Entities *(include if feature involves data)*

- **Suggested span** (not part of the user's structure): a candidate range within a completed AI
  message's text, possibly held in a hidden per-message cache (FR-013). It is `ai-suggested` by nature and shown only as such; it carries no id, no
  stored provenance state and no history, since it represents nothing more than "this text could
  be selected," not anything that has occurred.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Suggested underlines appear only on fully completed AI replies, in 100% of cases,
  never on a pending, streaming, incomplete, stopped or failed one.
- **SC-002**: Clicking any suggested span selects exactly that span's text and opens the same
  toolbar a manual selection would, in 100% of cases.
- **SC-003**: In a side-by-side view, a suggested span, a definition underline, and a confirmed
  branch marker are visually distinguishable from one another, and the suggestion reads as the
  least prominent.
- **SC-004**: Apart from the hidden cache (FR-013), no conversation, map, definition or history
  data is written for a suggested span that is never clicked: 0 records result from spans that
  are shown but not acted on.
- **SC-005**: Suggestions for a completed reply appear within 3 seconds of it completing, and the
  reply is readable and selectable during that time.
- **SC-006**: Viewing the same completed message twice shows the same suggested spans both times,
  in 100% of cases.

## Assumptions

- **Detection method**: left to planning. This is a real judgment call about what counts as
  "independently explorable" within a reply, not a syntactic rule like list detection; the spec
  only fixes its visible behavior and guardrails (completed replies only, the reply's own text
  only, not part of the user's structure, capped count).
- **Cap on spans per message**: 3. Article IV asks suggestion density to default toward sparse,
  and three is enough to point out a reply's main threads without cluttering it. Planning may
  lower it but not raise it without justification against Article IV.
- **Provenance (Article I)**: a suggested span is always `ai-suggested`, and the grey dotted
  underline is how that state is shown. It is never promoted to `user-confirmed`: clicking it only
  makes a selection, and the branch or definition the user then creates is recorded as they
  already are in Features 1 and 2. Because spans are never part of the user's structure, they never
  count toward depth or saturation and nothing can be derived from them.
- **Overlap handling**: how detection avoids or resolves overlapping candidate spans is left to
  planning; the constraint is only that a suggested span never visually swallows or hides a
  confirmed marker or a definition underline (FR-010).
- **Out of scope**: batch or bulk branching from multiple suggested spans at once; suggested
  underlines on the user's own messages; recording suggestions as part of the user's structure;
  any detection scoped specifically to markdown list syntax (superseded by the more general
  "independently explorable span" framing above); personalizing suggestions from behavior
  (Article VI).
