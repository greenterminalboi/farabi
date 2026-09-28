# Feature Specification: Information Pressure

**Feature Branch**: `006-information-pressure`

**Created**: 2026-09-27

**Status**: Draft

## Clarifications

### Session 2026-09-27

- Q: What does the setting affect? → A: Only the length and depth of newly generated AI chat
  replies. Node summaries, definition drafts, and every other AI-generated object in the app are
  unaffected (FR-006–FR-007).
- Q: Is this global, or per-project / per-conversation? → A: A single global default for this
  version; it applies uniformly to every conversation, root or branch, in every project (FR-008).
- Q: How many levels, and how are they presented? → A: Ten discrete levels on a slider with snap
  points (not a continuous value), grouped into five named bands of two levels each, in increasing
  order: Brief, Concise, Balanced, Detailed, Exhaustive (FR-002–FR-003).
- Q: What is the default level? → A: Level 8, within the Detailed band (FR-004).
- Q: Where does the control live? → A: A Settings surface, the same place flagged as a future need
  ("Settings tab for meta settings") in the Feature 003 feedback round; this feature does not add a
  separate per-conversation control.
- Q: How does a preference slider fit with Article VI's rule against static preference forms? →
  A: Article VI was clarified (Constitution 1.0.1, PATCH): it covers what the AI infers about how
  the user learns, not explicit user instructions about output form. The level is the user
  directing the AI (Article I), and it is never used as evidence for personalization (FR-014).
- Q (added at planning): Can the user also choose which AI model writes replies? → A: Yes. A model
  selection sits next to the level in Settings. Like the level, it is global, affects only chat
  replies, and is recorded on each reply (User Story 4, FR-015–FR-020).

**Depends on**: none structurally. The control lives in a Settings surface, which this feature
creates, because the app doesn't have one yet (FR-001).

**Input** (with the model selection added at planning): The user wants a single global control over how detailed AI chat replies are: a
"volume knob" they can turn down for short, concise answers or up for long, in-depth ones. It has
ten discrete levels grouped into five named bands, and defaults to level 8 ("Detailed"). It affects
only the chat reply text itself; nothing else the AI produces in the app changes because of it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Set how much detail replies contain (Priority: P1)

The user opens Settings and finds a slider with ten stops, labeled in five bands from Brief to
Exhaustive. They move it to a new level. From then on, without reloading or restarting anything,
new replies come back shorter or longer to match.

**Why this priority**: This is the entire feature; without a working control, there's nothing else
to test.

**Independent Test**: Open Settings, move the slider to a low level, send a message, and confirm
the reply is noticeably brief. Move it to a high level, send another message in the same or a
different conversation, and confirm the new reply is noticeably more detailed.

**Acceptance Scenarios**:

1. **Given** the Settings surface, **When** the user opens it, **Then** a slider with exactly ten
   stops is shown, grouped into five labeled bands (Brief, Concise, Balanced, Detailed, Exhaustive),
   with the current level and its band visible.
2. **Given** no prior change has been made, **When** the app is used for the first time, **Then**
   the level is 8, within the Detailed band.
3. **Given** the user moves the slider to a new level, **When** they leave Settings, **Then** the
   new level takes effect immediately for the next reply, with no reload or restart required.
4. **Given** a level has been set, **When** the user sends a message in any conversation, **Then**
   the reply's length and depth reflect that level.
5. **Given** a level has been set, **When** the user reloads the app or opens it in another browser
   on the same machine, **Then** the same level is still in effect.

---

### User Story 2 - The level applies everywhere, automatically (Priority: P1)

The user sets a level once. Every subsequent reply, whether in an existing root conversation, a new
one, or a freshly created branch, uses that same level without any extra setup per conversation.

**Why this priority**: A global setting that silently doesn't apply somewhere would be confusing
and would undermine the "single knob" premise of the feature.

**Independent Test**: Set a level, then generate replies in a root conversation, a highlight-based
branch, and a `????` quick branch. Confirm all three reflect the same currently active level.

**Acceptance Scenarios**:

1. **Given** a level is set, **When** the user starts a brand-new root conversation, **Then** its
   first reply uses the currently active level.
2. **Given** a level is set, **When** the user branches from a highlighted span or via `????`,
   **Then** the new branch's replies use the currently active level, the same as any other
   conversation. No per-branch or inherited setting is involved, since the level is global.
3. **Given** the level is changed mid-session, **When** the user sends a message in a conversation
   they had open before the change, **Then** the new reply reflects the new level, not whatever was
   active when that conversation began.

---

### User Story 3 - See what level produced a past reply (Priority: P2)

Months later, the user notices an old reply is unusually short or long compared to the app's
current behavior. They can tell it was generated under a different level setting at the time,
without that historical fact being erased by later changes to the global default.

**Why this priority**: Without this, changing the global setting quietly makes old replies look
inconsistent with new ones for no visible reason. It matters less than Stories 1–2 because it's a
transparency feature, not a functional one.

**Independent Test**: Set the level, send a message, then change the level and send another.
Inspect each reply and confirm each shows the level that was active when it, specifically, was
generated.

**Acceptance Scenarios**:

1. **Given** an AI reply, **When** its generation starts, **Then** the level active at that moment
   is recorded with it, and it stays recorded whether the reply completes, is stopped, is cut off,
   or fails.
2. **Given** the global level is later changed, **When** an older reply is inspected, **Then** its
   recorded level is unchanged: it reflects what generated it, not the current setting.
3. **Given** a reply's recorded level, **When** the user looks at that reply in the conversation,
   **Then** its level and band are visible on or next to the reply, without opening Settings or
   recalling what the global setting was at the time.
4. **Given** replies that existed before this feature, **When** they are inspected, **Then** they
   show no level, rather than a guessed one.

---

### User Story 4 - Choose which model writes replies (Priority: P2)

In Settings, next to the level, the user picks which AI model writes chat replies, for example a
faster, lighter model for quick questions or the most capable one for hard topics. From the next
reply on, every conversation uses that model, and each reply shows which model wrote it.

**Why this priority**: It's useful, but the app already works with a single configured model, so
it matters less than the level control itself (Stories 1–2).

**Independent Test**: In Settings, choose a different model, send a message, and confirm the reply
is labelled with that model. Switch back and confirm the next reply is labelled with the original
one, while the earlier reply keeps its label.

**Acceptance Scenarios**:

1. **Given** the Settings surface, **When** the user opens it, **Then** a model selection lists the
   available models by name, with the current choice selected.
2. **Given** no prior change, **When** the app is used for the first time, **Then** the selection
   is "Default", meaning the model the app is configured with, so behavior is unchanged until the
   user picks something else.
3. **Given** the user picks a model, **When** they send a message in any conversation, **Then** the
   reply is generated by that model, with no reload or restart required.
4. **Given** a reply, **When** the user looks at it, **Then** the model that was asked to write it
   is shown next to its level.
5. **Given** the chosen model is unavailable (for example, the user's AI setup can't use it), **When**
   a reply is requested, **Then** the reply fails the way any unavailable reply does today, with
   Retry offered, and the error says the chosen model couldn't be used.

---

### Edge Cases

- **Level changed while a reply is streaming**: the in-progress reply keeps the level that was
  active when its generation started; a mid-stream setting change never changes a reply already
  underway.
- **A reply is regenerated or retried**: the new reply uses whatever level is active when it
  starts, which may differ from the level recorded on the reply it replaces. Both levels are kept,
  one per reply, per Feature 1's rule that a replaced reply is kept, not erased.
- **Level set to either extreme (1 or 10)**: behaves normally, with no special-cased failure at
  the boundaries.
- **Summaries, definitions, suggested underlines, or any other AI-generated content**: none of it is
  affected by this setting under any circumstance; this holds even at the extremes.
- **Replies from before this feature**: they have no recorded level and show none (US3 AS4).
- **Model changed while a reply is streaming**: as with the level, the reply keeps the model it
  started with.
- **The model setting is changed outside the listed choices** (for example, a stale value after an
  app update removes a model): replies fall back to "Default", and Settings shows "Default"
  selected.
- **The setting can't be saved** (for example the app's storage is unavailable): the slider returns
  to the level still in effect and says the change wasn't saved; the level used for replies never
  differs from the one the slider shows.

## Requirements *(mandatory)*

### Functional Requirements

**Setting and control**

- **FR-001**: The system MUST offer a single global information pressure setting, reachable from a
  Settings surface that is itself reachable from every view.
- **FR-002**: The setting MUST offer exactly ten discrete levels on a slider with fixed snap
  points; it MUST NOT accept a continuous or free-form value.
- **FR-003**: The ten levels MUST be grouped, in increasing order, into five named bands of two
  levels each: Brief (1–2), Concise (3–4), Balanced (5–6), Detailed (7–8), Exhaustive (9–10).
- **FR-004**: The default level, before any user change, MUST be level 8, within the Detailed band.
- **FR-005**: Changing the level MUST take effect immediately for subsequent replies, with no
  reload or restart required, and MUST persist across reloads and browsers on the same install.

**Scope of effect**

- **FR-006**: The level MUST affect only the length and depth of newly generated AI chat replies.
- **FR-007**: The level MUST NOT affect node summaries, definition drafts, suggested underlines, or
  any other AI-generated content in the app.
- **FR-008**: The level MUST apply uniformly to every conversation, root or branch, in every
  project, since it is a single global value, not stored per conversation or per project in this
  feature.

**History and traceability**

- **FR-009**: Every AI reply MUST record the information pressure level that was active when its
  generation started.
- **FR-010**: A reply's recorded level MUST NOT change after the fact, even if the global setting
  is later changed, consistent with the rule that a sent or generated message's content and record
  never change after the fact.
- **FR-011**: The level recorded on a given reply MUST be visible to the user on or next to that
  reply in the conversation, without requiring them to recall what the global setting was at the
  time.
- **FR-012**: Every reply's recorded level MUST be kept indefinitely; it is never deleted or
  overwritten (Constitution Article VI).
- **FR-013**: Each change to the global level MUST be recorded with the time it was made, as
  user-authored, and never overwritten; the level in effect is the most recent change (Articles I
  and VI).

**Constitution alignment**

- **FR-014**: The level is an explicit user instruction about the form of replies, not
  personalization (Constitution 1.0.1, Article VI). It MUST NOT be used as evidence about how the
  user learns, and no other AI behavior may be tuned from it.

**Model selection**

- **FR-015**: Settings MUST offer a model selection for chat replies, listing "Default" plus a
  fixed set of named models. "Default" means the model the app is configured with.
- **FR-016**: The default selection, before any user change, MUST be "Default".
- **FR-017**: Like the level, the model selection MUST be global, take effect for the next reply
  with no reload, persist across reloads and browsers, and apply to every conversation (FR-005,
  FR-008).
- **FR-018**: The model selection MUST affect only chat replies; summaries, definition drafts and
  suggested underlines keep using the app's configured model (FR-007).
- **FR-019**: Every AI reply MUST record the model it was asked to be written by, fixed from when
  its generation started and never changed afterwards, and MUST show it on or next to the reply
  (FR-009–FR-012 apply to the model the same way).
- **FR-020**: Each change to the model selection MUST be recorded with its time, as user-authored,
  and never overwritten (FR-013).

### Key Entities *(include if feature involves data)*

- **Information pressure level**: an integer from 1 to 10, with a band name derived from it
  (FR-003).
- **Level change**: one user-authored change to the global level, with its time. The current
  level is the latest change, or 8 if there is none.
- **Reply model choice**: "Default" or one of the named models. Its changes are kept the same way
  as level changes.
- **Reply's recorded level and model** (extends Message): the level and model active when an AI
  reply's generation started. Both are fixed once set; replies from before this feature have
  neither.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Changing the level affects the next generated reply, in any conversation, with no
  reload required, in 100% of cases.
- **SC-002**: For the same set of prompts, replies at each band are on average longer than at the
  band below it, and the Exhaustive band's replies average at least 3 times the length of the Brief
  band's.
- **SC-003**: 100% of AI replies generated after this feature ships record the level active at
  their generation start, unaffected by any later change to the global default.
- **SC-004**: On a fresh install, the level is 8 (Detailed) in 100% of cases.
- **SC-005**: No node summary, definition draft, suggested underline or other non-reply AI content
  is requested any differently when the level changes: the instructions sent for them are
  identical at every level.
- **SC-006**: A user can find the controls and change the level or the model in under 30 seconds
  from any view.
- **SC-007**: After choosing a model, 100% of new replies are labelled with that model, and the
  replies are actually requested from that model.

## Assumptions

- **Band granularity**: the five named bands (Brief, Concise, Balanced, Detailed, Exhaustive) are
  the only labeled distinctions; the two levels within a band are not guaranteed to produce
  meaningfully different output from each other, only from levels in neighboring bands. This
  reflects real uncertainty about how finely reply length can be controlled, rather than
  overcommitting to ten distinct behavioral identities that haven't been validated.
- **Global means per install**: the level is stored with the app's data, not in one browser, so
  every browser on the same install sees the same level. This differs from Feature 5's Suggestions
  toggle, which is a per-browser display switch.
- **Settings surface**: a new Settings page reachable from the top bar. It starts with this
  control; moving other preferences into it (such as Feature 5's Suggestions toggle) is out of
  scope.
- **Level at generation start**: the level is captured when a reply's generation starts, so the
  edge case "changed while streaming" and FR-009 describe the same moment.
- **No per-conversation or per-project override in v1**: the global default is the only lever this
  feature adds. A future feature could layer a per-conversation override on top without conflicting
  with this data model, since the level is already recorded per reply (FR-009), not only globally.
- **Mechanism left to planning**: exactly how a level number maps to instructions given to the
  underlying AI model (for example, length guidance in the instructions) is a planning concern;
  this spec constrains only the user-facing control, its scope, and its history.
- **Model list**: the named models are a fixed list maintained with the app (see plan). The same
  list is offered whichever AI setup is in use; a setup that can't use a model reports it through
  the normal reply error (US4 AS5).
- **Out of scope**: per-conversation or per-project level or model overrides; changing the model
  used for summaries, definitions or suggested underlines; showing prices; any effect on summaries,
  definitions, suggested underlines or other non-chat-reply AI content; a continuous (non-stepped)
  control; changing the level of replies that already exist.
