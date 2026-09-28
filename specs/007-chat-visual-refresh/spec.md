# Feature Specification: Chat Bubble and Input Visual Refresh

**Feature Branch**: `007-chat-visual-refresh`

**Created**: 2026-09-27

**Status**: Draft

## Clarifications

### Session 2026-09-27

- Q: Does this change any data, provenance state, or interaction behavior from earlier features?
  → A: No. This is purely a visual and layout change to how existing messages and the composer
  are rendered; message content, states, and all prior functional requirements are unaffected
  (FR-010).
- Q: Does the existing "AI" text tag on AI-authored messages get removed? → A: No. It was
  deliberately kept in the Feature 003 feedback round ("AI replies have no bubble but keep the AI
  tag") and this feature does not reopen that decision (FR-003).
- Q: What's the reference for the new look? → A: The general visual language of a familiar chat
  interface: right-aligned, content-sized user bubbles; plain, unbubbled, left-aligned AI text; a
  centered reading column with margins; a single rounded composer with an embedded, icon-only send
  control. This is a directional reference, not a pixel-exact clone (see Assumptions).

**Depends on**: Feature 1, Branching Chat with Map View (`specs/001-branching-chat-map/`), whose
chat view this restyles. Feature 3's feedback round (`specs/003-feedback-loop/` outcomes) already
established the composer's auto-grow behavior and the AI tag decision, both of which this feature
keeps. Feature 2 (definition underlines) and Feature 5 (suggested branch underlines) render text
inside AI replies and must be left untouched (FR-011).

**Input**: Farabi's current chat panel renders AI replies correctly (plain text, no bubble, AI
tag), but user messages are left-aligned in a way that reads more like a form than a
back-and-forth conversation. The request is to give user messages a right-aligned, content-sized
bubble; keep AI replies as they are; contain the whole conversation in a centered reading column
with real margins; and restyle the message composer as a single rounded input with an embedded,
icon-only send control, matching the direction of familiar modern chat interfaces.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Messages read as a conversation (Priority: P1)

The user sends a short message and gets a longer AI reply back. Their own message sits in a
tight, rounded bubble anchored to the right side of the column, sized to its own text. The AI's
reply sits at the left, in plain text with no bubble, marked with the existing AI tag. The back-
and-forth is visually obvious at a glance, without reading the content.

**Why this priority**: This is the entire visual goal of the feature; every other requirement
supports it.

**Independent Test**: Send a short message and a long one in the same conversation. Confirm both
appear right-aligned in bubbles sized to their own content, not stretched to the column width, and
that AI replies remain unbubbled, left-aligned, plain text with the AI tag intact.

**Acceptance Scenarios**:

1. **Given** the user sends a message, **When** it appears in the chat, **Then** it is
   right-aligned within the column, inside a rounded, shaded bubble sized to its own content.
2. **Given** an AI reply is shown, **When** the user views it, **Then** it remains left-aligned,
   plain text with no background or border, exactly as it renders today, with its AI tag intact.
3. **Given** a very short user message (e.g. a single word), **When** it renders, **Then** its
   bubble is small and content-sized, not stretched to fill the available width.
4. **Given** a long user message spanning several lines, **When** it renders, **Then** its bubble
   wraps and grows in height but stays capped at the reading column's maximum width.

---

### User Story 2 - A consistent, centered reading column (Priority: P2)

The user views a conversation on a wide browser window. Instead of messages stretching edge to
edge, the whole exchange sits inside a centered column with comfortable margins on both sides,
matching how the AI's replies already read today.

**Why this priority**: Without a shared column width, the new user bubbles and the existing AI
text would feel like they belong to two different layouts. This depends on Story 1 to be
meaningful.

**Independent Test**: Open a conversation in a wide browser window and confirm both user bubbles
and AI text stay within the same centered, margined column rather than stretching to the window's
edges.

**Acceptance Scenarios**:

1. **Given** any viewport width the app supports, **When** a conversation is viewed, **Then** all
   messages render inside a centered column with consistent margins on both sides.
2. **Given** the reading column's maximum width, **When** both a user bubble and an AI reply are
   compared, **Then** neither exceeds that same maximum width.

---

### User Story 3 - A composer that matches the rest of the surface (Priority: P1)

The user goes to type a message. The input area is a single rounded container, visually
consistent with the new message bubbles, with the send action shown as a small icon embedded
inside the box rather than a separate labeled button beside it. Typing still grows the box exactly
as it already does.

**Why this priority**: The composer is the most-used element on the screen; leaving it visually
mismatched against the restyled conversation above it would undercut the whole refresh.

**Independent Test**: Open the composer, confirm it renders as a single rounded input with an
icon-only send control inside its bounds, type a long message and confirm it still grows as
already specified, then send it and confirm the send control still works.

**Acceptance Scenarios**:

1. **Given** the composer, **When** it is empty, **Then** it shows subdued placeholder text inside
   a single rounded input container.
2. **Given** the composer, **When** the user looks at the send action, **Then** it appears as a
   small icon embedded within the input container's bounds, not as a separate labeled button
   outside it.
3. **Given** the user types a message, **When** the placeholder text was showing, **Then** it
   disappears as soon as typing begins.
4. **Given** the user types a long message, **When** it exceeds one line, **Then** the composer
   grows exactly as it already does today (up to roughly half the visible height, then scrolling
   internally), unchanged by this feature.
5. **Given** a message has been typed, **When** the user activates the send icon, **Then** the
   message sends exactly as it does today.

---

### Edge Cases

- **Suggested-underline spans or definition underlines inside an AI reply**: unaffected by this
  feature; they continue to render exactly as their own specs define, since only message
  containers and placement are changing here, not text-level treatment within AI messages.
- **A branch's inherited parent context** (Feature 1 FR-033): keeps its own distinct, read-only,
  visually-set-apart treatment; this feature only requires that it continue to fit comfortably
  within the new, narrower reading column, not that its own visual treatment change.
- **A message consisting only of a single emoji or very short token**: bubble sizing still hugs
  the content without becoming oddly small or clipped.
- **A user message containing a very long unbroken token** (e.g. a URL): it wraps or breaks
  within the bubble rather than pushing the bubble past the reading column's maximum width.
- **Composer at maximum grown height**: unchanged from existing behavior; this feature restyles
  its chrome (shape, send control), not its growth limits.
- **Send icon with an empty composer or while a reply is in progress**: it keeps whatever
  enabled/disabled behavior the current send button has; only its appearance changes.

## Requirements *(mandatory)*

### Functional Requirements

**Message layout**

- **FR-001**: User-authored chat messages MUST render right-aligned within the chat column, inside
  a rounded, background-shaded bubble sized to their own content rather than stretched to the
  column's full width.
- **FR-002**: AI-authored chat messages MUST continue to render left-aligned as plain text with no
  background or border, unchanged from current behavior.
- **FR-003**: The existing AI tag on AI-authored messages MUST be preserved exactly as previously
  implemented; this feature does not alter or remove it.
- **FR-004**: The chat conversation MUST render within a centered, fixed-width reading column with
  consistent margins on both sides, rather than stretching edge-to-edge.
- **FR-005**: Both user bubbles and AI plain text MUST respect the same maximum reading-column
  width, so neither exceeds a comfortable line length.

**Input field**

- **FR-006**: The message composer MUST render as a single rounded input container, visually
  consistent with the rounding and shading used for user message bubbles (FR-001).
- **FR-007**: The composer's send action MUST be an icon-only control embedded within the input
  container's bounds, rather than a separate labeled button outside it. It MUST keep an accessible
  name (e.g. "Send") so it remains identifiable without a visible label, and MUST keep the existing
  send button's enabled/disabled behavior and keyboard send behavior.
- **FR-008**: The composer MUST retain its existing auto-grow behavior unchanged: growing with
  content up to roughly half the visible height, then scrolling internally.
- **FR-009**: Placeholder text in the composer MUST remain visually subdued relative to typed
  text, and MUST disappear as soon as the user begins typing, consistent with current behavior.

**Non-goals**

- **FR-010**: This feature MUST NOT alter any data model, provenance state, or interaction
  behavior defined in Features 1 through 5; it changes only the visual rendering of message
  placement, bubbling, and composer chrome.
- **FR-011**: Suggested-underline spans (Feature 5) and definition-term underlines (Feature 2)
  MUST continue to render within AI messages exactly as their own specs define, unaffected by this
  feature.

### Key Entities *(include if feature involves data)*

None. This feature is purely presentational and introduces no new stored data, states, or
provenance objects.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a side-by-side review, user messages appear right-aligned in content-sized
  bubbles and AI messages appear left-aligned as plain text with the AI tag intact, in 100% of
  conversations reviewed.
- **SC-002**: The chat reading column maintains consistent left and right margins across at least
  three tested viewport widths, with no edge-to-edge stretching observed.
- **SC-003**: The composer reads as a single rounded input element with an embedded, icon-only
  send control in 100% of manual review sessions.
- **SC-004**: No regression is observed in the composer's auto-grow behavior or in any Feature
  1–5 functional requirement after this change ships.

## Assumptions

- **Directional reference, not a pixel clone**: the goal is matching the general visual
  language (right-aligned content-sized user bubbles, plain unbubbled AI text, a centered margined
  column, and an embedded icon-only send control), not reproducing exact colors, corner radii, or
  spacing values from any other product. Precise values are left to design and planning.
- **AI tag decision stands**: the AI tag's presence and styling were already settled in the Feature
  003 feedback round and are treated as fixed input to this feature, not something it revisits.
- **Branch context treatment stands**: how a branch displays its inherited parent context (Feature
  1 FR-033) is unchanged by this feature beyond needing to fit the new column width.
- **Constitution fit**: the distinct treatment of user-authored bubbles versus unbubbled, tagged AI
  text keeps authorship visually unambiguous, in line with Article I; nothing here touches
  provenance states themselves.
- **Parallel work**: Feature 006 (Information Pressure) is being developed at the same time on a
  separate branch. It changes AI reply length and model selection, not chat layout, so no
  functional overlap is expected; any merge conflicts in the chat view are resolved at integration
  without changing either feature's requirements.
- **Out of scope**: any change to message content, editing rules, streaming behavior, suggested
  underlines, definition underlines, or the map view. Only chat-message container layout, bubbling,
  and composer chrome are in scope.
