# Feature Specification: In-App Feedback Loop

**Feature Branch**: `003-feedback-loop`

**Created**: 2026-09-27

**Status**: Draft

## Clarifications

### Session 2026-09-27

- Q: Does a feedback item automatically record where it was captured from? → A: Yes; the current
  view (chat or map) and the open node, if any, are captured automatically (FR-006). No
  message-level or highlighted-span anchoring is required.
- Q: Can items be manually reordered, or is order always chronological? → A: Manual drag-to-reorder
  is supported per item; only items the user has touched get a stored order, everything else stays
  in default reverse-chronological order (FR-008–FR-009).
- Q: Where does the feedback button live? → A: Global and always visible, reachable from every
  view in the app, not scoped to a single conversation or the map (FR-001).
- Q: Are tags a fixed taxonomy or freeform? → A: Freeform text, any number per item, matched
  exactly (after normalizing case and spacing) for filtering; no fixed category list and no
  AI-suggested tags (FR-004, FR-010).
- Q: How does Claude Code read feedback, given it is a terminal coding agent, not a service with
  database credentials? → A: Every write to feedback data regenerates a plain file on disk that
  Claude Code reads the same way it already reads `tasks.md`; the app's database stays the
  canonical store (FR-017–FR-018).
- Q: Who can close a feedback item? → A: Only the user can mark an item `resolved`. Claude Code can
  mark an item `addressed` (a suggestion that it has done the work) by running a provided terminal
  script; it cannot mark anything `resolved` and cannot edit an item's text, tags or attachments
  (FR-012–FR-015, FR-019–FR-020).

**Depends on**: Feature 1, Branching Chat with Map View (`specs/001-branching-chat-map/`), for the
notion of a view and a node that a feedback item's context can point to. This feature adds no new
requirement on Feature 2.

**Input**: The project owner is the sole user of Farabi and wants a tight, low-friction feedback
loop to drive the app's own ongoing development, since the app is UI-heavy and issues are often
easier to show than to describe. A global button opens a feedback panel where the user can log
freeform text, optional screenshots (pasted or dropped in), and optional freeform tags, with the
current view captured automatically. Items sit in the panel, can be manually reordered, and can be
filtered by tag. Claude Code (the coding agent building Farabi) reads outstanding feedback from a
file on disk and can flag an item as addressed once it believes the work is done; only the user
can confirm an item as truly resolved. Nothing is ever deleted. This feature has no AI involvement
inside the running app itself — no drafting, categorizing or summarizing of feedback — all
judgment happens externally, in the user's review and in Claude Code's own work.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Capture feedback from anywhere (Priority: P1)

While using Farabi — in a conversation, mid-branch, or looking at the map — the user notices
something worth flagging: a bug, a rough edge, an idea. They click the feedback button, which is
always visible, type a note, optionally paste a screenshot and add a tag or two, and submit. The
item is saved immediately with no AI call and no delay, and the app remembers where the user was
when they logged it.

**Why this priority**: This is the entire point of the feature. If capturing a thought costs more
than a few seconds, the user won't do it consistently, and the feedback loop this feature exists
to create never forms.

**Independent Test**: From the chat view, click the feedback button, type text, submit. From the
map view, do the same. Confirm both items exist afterward with the correct view recorded, and that
submission never waits on any AI service.

**Acceptance Scenarios**:

1. **Given** the user is in any view of the app, **When** they click the feedback button,
   **Then** a feedback form opens without navigating away from what they were doing.
2. **Given** the feedback form is open, **When** the user types non-empty text and submits with no
   attachment or tags, **Then** a new item is created in the `open` state with a creation time.
3. **Given** the feedback form is open, **When** the user submits with only whitespace or empty
   text, **Then** submission is blocked and no item is created.
4. **Given** the user submits feedback while looking at a specific node's conversation, **When**
   the item is created, **Then** it records that view and that node's id as context.
5. **Given** the user submits feedback while looking at the map, **When** the item is created,
   **Then** it records the map as the view, with no node id.
6. **Given** the AI service Farabi uses for chat is unreachable, **When** the user submits
   feedback, **Then** submission still succeeds immediately, since this feature has no dependency
   on any AI service.

---

### User Story 2 - Browse and organize the feedback panel (Priority: P1)

The user opens the feedback panel to see everything they've logged. New items appear at the top by
default. Over time the list grows long, so the user drags a couple of important items higher, and
later filters the list down to just the items tagged "map" to review them together.

**Why this priority**: A pile of feedback nobody can navigate is as useless as no feedback at all.
Organization is what turns the log into something the user actually returns to.

**Independent Test**: Submit several items across different views and with different tags. Open
the panel and confirm newest-first order. Drag one item to the top. Reload the app and confirm the
manual position held. Filter by one tag and confirm only matching items show.

**Acceptance Scenarios**:

1. **Given** the feedback panel, **When** the user opens it, **Then** every item is listed with
   its text, tags, attachments (if any), state, and captured context.
2. **Given** no item has been manually reordered, **When** the panel is shown, **Then** items
   appear newest-first.
3. **Given** the user drags an item to a new position, **When** they release it, **Then** that
   item's position is saved and holds after a reload; items never touched keep appearing in
   default order around it.
4. **Given** items with different tags, **When** the user filters by one tag, **Then** only items
   carrying that tag (matched exactly, ignoring case and extra spacing) are shown.
5. **Given** the panel, **When** the user clears the tag filter, **Then** the full list returns
   with all manual and default ordering intact.

---

### User Story 3 - Claude Code reads and acts on feedback (Priority: P1)

Between sessions of using Farabi, the user runs Claude Code against the project. Claude Code reads
the current feedback straight from a file on disk — the same way it already reads `tasks.md` — and
picks an item to work on. Once it believes it has made the fix, it flags that item as addressed by
running a small script, without ever touching the app's database directly or needing any
credentials.

**Why this priority**: This is what makes the feedback loop actually close the gap between
"noticed" and "fixed." Without a mechanism Claude Code can use on its own, feedback stays a list
the user has to manually re-explain in every session.

**Independent Test**: Submit an item with a screenshot. Confirm a file on disk lists the item's
text, tags, context and a path to the screenshot. Run the provided script against that item's id
and confirm its state becomes `addressed` and the file updates to reflect it.

**Acceptance Scenarios**:

1. **Given** any change to feedback data (a new item, a new attachment, a tag, a reorder, a state
   change), **When** the change is saved, **Then** a plain file on a fixed, documented path is
   regenerated to reflect the current state of every item.
2. **Given** the regenerated file, **When** it is read, **Then** it includes, per item, the text,
   tags, state, context, timestamps, and file paths to any attachments — everything needed to act
   on the item without querying the database.
3. **Given** an open item, **When** Claude Code runs the provided terminal script against that
   item's id, **Then** the item's state becomes `addressed` and the change is timestamped.
4. **Given** the addressed-marking script, **When** it runs, **Then** it can only change an item's
   state; it cannot edit the item's text, tags or attachments, and cannot set any state other than
   `addressed`.
5. **Given** an item that is not `open` (already `addressed` or `resolved`), **When** the script is
   run against it, **Then** the action is rejected or is a no-op, since only the user's own actions
   in the app can move an item out of `addressed` or `resolved`.

---

### User Story 4 - Confirm or reopen an item (Priority: P2)

The user reviews the panel and sees an item Claude Code marked `addressed`. They check the app,
confirm the fix, and mark it `resolved` themselves. Later, they notice a different resolved item
has actually regressed, so they reopen it.

**Why this priority**: The loop isn't trustworthy unless the user has the final word. This is a
smaller addition on top of Stories 1–3 but is what keeps the feature aligned with the project's
core principle that the AI only ever suggests.

**Independent Test**: Mark an item `addressed` via the script from Story 3. In the app, confirm it
as `resolved`. Then reopen it and confirm it returns to `open`, with both transitions kept in its
history.

**Acceptance Scenarios**:

1. **Given** an item in the `addressed` state, **When** the user confirms it in the panel,
   **Then** its state becomes `resolved`, recorded as `user-confirmed`.
2. **Given** an item in the `open` state (never addressed), **When** the user marks it resolved
   directly, **Then** that is allowed — confirmation does not require passing through `addressed`
   first.
3. **Given** an item in any state, **When** the user reopens it, **Then** its state returns to
   `open`, and the reopening is recorded rather than erasing the prior state's history.
4. **Given** an item's full history of state changes, **When** the user or Claude Code inspects
   it, **Then** every transition and its time is visible, none overwritten.

---

### User Story 5 - Attach a screenshot for visual context (Priority: P2)

The user notices a layout glitch on the map. Words are impossible without a picture, so they take
an OS-level screenshot, paste it directly into the open feedback form, and submit. The image is
stored where Claude Code can open it directly from disk.

**Why this priority**: Farabi is UI- and map-heavy; a meaningful share of real feedback will be
about how something looks, which text alone often can't capture. This depends on Story 1's form
existing first.

**Independent Test**: Paste an image into the feedback form and submit. Confirm the item shows a
thumbnail in the panel, the full image opens on request, and the regenerated file (Story 3)
references the attachment's path correctly.

**Acceptance Scenarios**:

1. **Given** the feedback form is open, **When** the user pastes or drags an image file into it,
   **Then** it is attached to the item being composed, shown as a preview before submission.
2. **Given** an item with one or more attachments, **When** it is submitted, **Then** each image is
   stored on disk under that item's own location, never overwriting another item's attachments.
3. **Given** an item with attachments, **When** the user views it in the panel, **Then** each
   attachment shows as a thumbnail that opens full-size on request.
4. **Given** an item with attachments, **When** the regenerated file (FR-017) is produced, **Then**
   it includes a file path to each attachment.
5. **Given** an item has been resolved, **When** its attachments are checked afterward, **Then**
   they are still present and unchanged.

---

### Edge Cases

- **Submission with no text**: blocked; an item cannot exist with empty or whitespace-only text,
  even if a screenshot is attached.
- **Submission with only a screenshot and no tags**: allowed; tags and attachments are both
  optional, text is the only required field.
- **Tag typed with different case or spacing** ("Map View", "map view", "map  view"): treated as
  the same tag for filtering purposes, consistent with how Feature 2 matches definition terms.
- **Reordering interacts with new items**: a newly submitted item appears at the top of the
  default order; it does not disturb any item's manually-set position.
- **Marking an item addressed twice**: each run of the script against an already-`addressed` item
  is a no-op (or rejected) rather than creating a duplicate `addressed` event; only an `open` item
  can newly become `addressed`.
- **User resolves an item Claude Code never touched**: allowed; the user's authority to resolve an
  item does not depend on it having passed through `addressed` first.
- **Reopening a resolved item**: allowed at any time; the previous resolution stays in history
  rather than being erased.
- **Feedback captured with no node open** (e.g. the map, or a view with nothing selected): context
  records the view only; node id is simply absent, not a placeholder value.
- **The regenerated file is stale or fails to write**: the previous version of the file remains on
  disk; Claude Code may act on slightly outdated information until the next successful write, but
  no feedback data is lost, since the app's database remains the source of truth.
- **Very large or many screenshots on one item**: allowed; specific size or count limits are left
  to planning.
- **Deleting a tag, attachment, or item**: not possible in this feature (see Assumptions); this is
  consistent with Article II.

## Requirements *(mandatory)*

### Functional Requirements

**Capture**

- **FR-001**: A feedback button MUST be visible and reachable from every view of the app (chat and
  map alike), not scoped to any single conversation.
- **FR-002**: Clicking the feedback button MUST open a form without navigating the user away from
  their current view.
- **FR-003**: The form MUST require non-empty, non-whitespace-only text before it can be
  submitted.
- **FR-004**: The user MAY add any number of freeform text tags to an item at submission time.
- **FR-005**: The user MAY attach one or more images to an item, added by pasting or dragging them
  into the form.
- **FR-006**: Submission MUST automatically record the current view (chat or map) and, if a node's
  conversation is open, that node's id, as the item's context. No message-level or highlighted-text
  anchoring is required.
- **FR-021** *(zero AI dependency)*: Capturing and submitting feedback MUST NOT depend on any
  online AI service being reachable; it MUST succeed immediately from local data alone.

**Panel and organization**

- **FR-007**: The app MUST offer a feedback panel, reachable from anywhere, that lists every
  feedback item regardless of state.
- **FR-008**: Items with no manually-set position MUST be shown in reverse-chronological order
  (newest first).
- **FR-009**: The user MUST be able to drag an item to a new position in the list; that position
  MUST persist across sessions and MUST NOT change the position of items the user has not touched.
- **FR-010**: The user MUST be able to filter the panel to items carrying a given tag, matched
  exactly after normalizing case and collapsing repeated spaces.
- **FR-011**: Each item in the panel MUST show its text, tags, attachment thumbnails (if any),
  current state, and captured context.

**State and resolution**

- **FR-012**: Every feedback item MUST carry exactly one state at a time: `open`, `addressed`
  (`ai-suggested`), or `resolved` (`user-confirmed`).
- **FR-013**: Only the user, acting in the app, MAY mark an item `resolved`.
- **FR-014**: An item MAY be marked `resolved` directly from `open`; passing through `addressed`
  first is not required.
- **FR-015**: The user MUST be able to reopen any item, from either `addressed` or `resolved`,
  back to `open`, at any time.
- **FR-016**: Every state transition MUST be recorded with its own timestamp; no transition
  overwrites or removes the record of a previous one (Constitution Article VI).

**Claude Code integration**

- **FR-017**: Every write to feedback data (a new item, a new attachment, a tag change, a reorder,
  a state change) MUST regenerate a plain file on a fixed, documented path, readable directly from
  the filesystem, the same way Claude Code already reads this project's `tasks.md`.
- **FR-018**: The regenerated file MUST include, for every item, its text, tags, state, context,
  relevant timestamps, and a file path to each of its attachments, sufficient for Claude Code to
  act on the item without querying the database.
- **FR-019**: The system MUST provide a terminal script that Claude Code can run, given an item's
  id, to change that item's state from `open` to `addressed`.
- **FR-020**: The script in FR-019 MUST NOT be able to edit an item's text, tags or attachments,
  MUST NOT be able to set any state other than `addressed`, and MUST have no effect when run
  against an item that is not currently `open`.

**Attachments**

- **FR-022**: Each attachment MUST be stored on disk under a location specific to its item,
  without overwriting another item's attachments.
- **FR-023**: An item's attachments MUST remain unchanged and available regardless of later state
  changes to that item, including after it is marked `resolved`.

**Data retention**

- **FR-024**: No feedback item, tag, attachment, or state-transition record can be deleted by any
  action in this feature (Constitution Article II).
- **FR-025**: All feedback data (items, tags, attachments, positions, state history) MUST persist
  across sessions and app restarts.
- **FR-026**: Every AI-touched object this feature produces (an `addressed` flag) MUST be stored
  and shown as `ai-suggested`; every user action (submission, tags, attachments, reordering,
  resolving, reopening) MUST be recorded as `user-authored` or `user-confirmed` as defined above
  (Constitution Article I).

### Key Entities *(include if feature involves data)*

- **Feedback item**: freeform text, zero or more tags, zero or more attachments, a state
  (`open`, `addressed`, `resolved`), captured context (view, and a node id if applicable), an
  optional manually-set position, and a creation time.
- **Feedback tag**: freeform text attached to a feedback item; an item may carry several; matched
  for filtering after normalizing case and spacing.
- **Feedback attachment**: one image file linked to a feedback item, stored on disk, with the time
  it was added.
- **Feedback state event**: an append-only record of one state transition for one item — its new
  state, the time, and whether it was made by the user or by the Claude Code script — never
  overwritten or removed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The feedback button is reachable in one click from every view of the app, with no
  exceptions.
- **SC-002**: Submitting a text-only feedback item completes in under 1 second, with no dependency
  on any AI service being reachable.
- **SC-003**: 100% of feedback items, tags, attachments, and their state histories persist
  unchanged across an app restart.
- **SC-004**: The regenerated feedback file reflects a new item or state change within 1 second of
  it being saved, so Claude Code never acts on data more than briefly out of date.
- **SC-005**: In a review of state histories, 100% of items show every transition they have ever
  had, with none overwritten or missing.
- **SC-006**: Reordering one item never changes the on-screen or stored position of any other item
  that has not itself been dragged.
- **SC-007**: The `addressed` script changes only an item's state in 100% of runs; it never alters
  an item's text, tags, or attachments, and has no effect when targeting a non-`open` item.
- **SC-008**: With at least 200 feedback items, including screenshots, the panel opens and scrolls
  without noticeable stutter.

## Assumptions

- **Zero in-app AI involvement**: no AI model inside the running Farabi app drafts, categorizes,
  summarizes, or suggests tags or priority for feedback. All judgment is external — the user's own
  review, and Claude Code's own reasoning when it reads the regenerated file. This keeps the
  feature from getting ahead of real evidence about what categorization would even be useful
  (Constitution Article III).
- **Tag matching**: two tags are the same for filtering purposes when they match after trimming,
  collapsing repeated spaces, and ignoring letter case — the same rule Feature 2 uses for
  definition terms.
- **Text is required, attachments are not**: an item must always have non-empty text; it may exist
  with zero attachments and zero tags.
- **Claude Code's access model**: Claude Code is a terminal coding agent with filesystem access to
  the project, not a service holding database credentials. It reads feedback exclusively through
  the regenerated file (FR-017) and acts on it exclusively through the provided script (FR-019),
  mirroring how it already reads `tasks.md` and runs the project's other scripts. It is given no
  broader write access to feedback data than that one script allows.
- **No deletion in v1**: consistent with Feature 1 and Feature 2, this feature adds no way to
  delete feedback items, tags, attachments, or history. Constitution Article II allows rare,
  explicit, user-chosen deletion as a separate feature, but that is out of scope here.
- **Single user, one device**: consistent with Feature 1's v1 scope; no sharing, sync, or
  multi-device consideration is needed for feedback data.
- **Screenshot handling**: standard image formats (e.g. PNG, JPEG) captured at the OS level and
  pasted or dropped into the form; the app does not capture the screen itself. Specific size or
  count limits per item are left to planning.
- **Out of scope**: AI-drafted or AI-suggested tags, categories, priority, or summaries for
  feedback; automatic conversion of a feedback item into a task or spec; any in-app AI reasoning
  about feedback content; export or sharing of feedback outside the project; deleting any feedback
  data; multi-device sync.
