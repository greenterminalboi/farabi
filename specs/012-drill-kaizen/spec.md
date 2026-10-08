# Feature Specification: Drill Kaizen

**Feature Branch**: `012-drill-kaizen`

**Created**: 2026-10-07

**Status**: Draft

## Clarifications

### Session 2026-10-07

- Q: Where does a drill live? → A: On its own drill screen. The project canvas shows one drill node
  that opens it; rounds, problems and attempts are not drawn on the canvas (FR-003–FR-004).
- Q: Who applies a difficulty step? → A: The drill steps automatically from the round's results. The
  user can still override any verdict or set a level by hand, and progression is recomputed from
  that (FR-019–FR-021).
- Q: What does a drill feel like? → A: A ladder through the domain, not a pile of problems. Example:
  for Python dictionaries, the drill first teaches adding an entry, then looking up values, then
  missing keys, iteration, comprehensions, merging and so on, each introduced with a short lesson
  and drilled until solid before the next is opened, while earlier ones keep coming back at higher
  difficulty (FR-002, FR-005–FR-008).
- Q: Does a round show one problem at a time or the whole round? → A: One at a time. The user answers,
  gets the verdict, then moves on; earlier problems in the round stay reachable (FR-009).
- Q: Where does a "why?" follow-up on a problem happen? → A: On the canvas. Asking a follow-up from the
  drill screen automatically creates a branch leaving the drill node; there is no separate chat inside
  the drill (FR-026, FR-030).
- Q: What may the AI read when writing lessons and problems? → A: The drill's own material (domain,
  ladder, lessons, earlier problems, attempts and verdicts) plus any project conversations the user
  attaches to the drill. When the drill is complete, it offers the drill's follow-up branches and
  attached conversations as starting points for new drills (FR-031–FR-033).

**Depends on**: Feature 010, Farabi v0.2 Message Graph and Canvas
(`specs/010-v02-message-graph-canvas/`), whose node kinds, function definitions, generic runner,
provenance states and kind settings this feature builds on. Feature 004 (Projects) sets the boundary
a drill lives in. Feature 006 supplies the reply model setting.

**Input**: User description: "Drill Kaizen: the second sub-feature for Farabi. The AI builds a
problem set for a problem domain the user assigns (user-assigned for now), then incrementally
increases the difficulty. This is not a LeetCode-style problem generator; it is an iterative
builder that takes a problem domain and helps the user drill it down and learn it, round by round,
with difficulty stepping up as the user improves."

### Constitution Check

| Article | How this feature meets it |
|---------|---------------------------|
| I. The User Is the Final Authority | The domain and attempts are user-authored. The ladder, lessons, problems, verdicts and automatic level changes are ai-suggested and shown as such. The user can override any verdict, reorder or edit the ladder, and set any level by hand (user-authored), and an override always wins over the AI's value. Automatic stepping applies ai-suggested changes for speed; it never relabels them as confirmed. |
| II. Growth Is Additive, Never Reconciled | Every round, lesson, problem, attempt, verdict, override and level change is kept. New attempts and replacement problems are added beside earlier ones. A level going down is a new recorded change, never a rewrite of history. |
| III. Nothing Is Invented Ahead of Evidence | Lessons and problems are practice material the user explicitly asked for, always marked AI-generated, and never presented as insight about the user's own map. They read only the drill's own material and the conversations the user attached. Drills offered on completion come only from the user's own follow-ups and attached conversations, never from a generic topic list. The order of the ladder is an ai-suggested proposal the user can edit, not a coupling claimed between the user's nodes. Difficulty moves only on the user's own recorded attempts. |
| IV. User-Led Exploration Takes Priority | A drill starts only when the user assigns a domain or picks one of the offered starting points. The only AI-initiated suggestion is the short list of next drills shown once, when a drill completes; it is capped at 3, never blocks anything, and nothing is created unless the user picks one. A drill never blocks branching or chat elsewhere. |
| V. Compression Preserves Meaning, Not Just Length | Every level shown traces to the level changes and attempts behind it, and every verdict to the attempt and problem it judged. |
| VI. History Is Data, Not Decoration | Difficulty adapts from observed attempts, never from a self-rating. The full history is kept as the record of how the user learned the domain. |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start a drill on a domain (Priority: P1)

The user adds a drill to a project and types a domain, for example "Python dictionaries". A drill
node appears on the canvas and the drill screen opens. The AI proposes a ladder of rungs in order,
from the most basic to the most advanced ("add an entry", "read a value by key", "handle a missing
key", "iterate keys and values", "dictionary comprehensions", "merge dictionaries", ...). The user
can edit, reorder, remove or add rungs, then starts. Rung 1 opens with a short lesson and the first
round.

**Why this priority**: Without a domain, a ladder and a first round there is nothing to drill.

**Independent Test**: In a project, add a drill with the domain "Python dictionaries". Confirm a drill
node appears on the canvas, the drill screen shows an ordered, ai-suggested ladder, and after
starting, rung 1 has a lesson and a first round at level 1.

**Acceptance Scenarios**:

1. **Given** a project canvas, **When** the user adds a drill and enters a domain, **Then** one drill
   node appears on the canvas and the drill screen opens with the domain as user-authored text.
2. **Given** a new drill, **When** the AI proposes a ladder, **Then** its rungs are ordered from basic
   to advanced, each ai-suggested, and the user can edit, reorder, remove and add rungs before
   starting.
3. **Given** the user starts the drill, **When** the first round is generated, **Then** only rung 1 is
   open, it shows a short lesson, and the round has 3 to 5 problems on rung 1 at level 1.
4. **Given** the AI service is unreachable, **When** a ladder, lesson or round is requested, **Then**
   nothing is created, a clear error with retry is shown, and what the user typed is kept.

---

### User Story 2 - Attempt a problem and get feedback (Priority: P1)

The user writes an answer to a problem (for dictionaries, a line of code or a short explanation). The
AI judges it: what was right, what was wrong or missing, and a verdict of solved, partly solved or not
solved. The user can try the same problem again, ask for a hint, or reveal a worked solution. If they
disagree with a verdict they change it.

**Why this priority**: The attempt and feedback loop is the drill, and progression runs on it.

**Independent Test**: Answer one problem correctly and one wrongly. Confirm each gets an ai-suggested
verdict with feedback, a second attempt is added beside the first, and overriding a verdict records
the user's verdict without removing the AI's.

**Acceptance Scenarios**:

1. **Given** a problem, **When** the user submits an attempt, **Then** the attempt is stored as
   user-authored and a verdict with feedback referring to that attempt is produced as ai-suggested.
2. **Given** a verdict, **When** the user overrides it, **Then** the user's verdict is recorded as
   user-authored, the AI's is kept, and progression uses the user's.
3. **Given** a problem, **When** the user asks for a hint, **Then** a hint is shown and later attempts
   at that problem are marked hinted.
4. **Given** a problem, **When** the user reveals the solution, **Then** it is shown and the problem
   counts as not solved for progression.
5. **Given** an attempt, **When** the user tries the same problem again, **Then** a new attempt and
   verdict are added and the earlier ones are unchanged.
6. **Given** a round in progress, **When** it is shown, **Then** only the current problem is open; the
   next appears once the current one has a verdict or the user skips it, and earlier problems in the
   round can be reopened.

---

### User Story 3 - Climb the ladder automatically (Priority: P1)

The user finishes a round and the next one is ready without asking them anything. Where they were
solid, the level goes up: adding an entry moves from `d["a"] = 1` to adding entries inside a loop,
then to building a dictionary from two lists. Once a rung is solid, the next rung opens with its own
short lesson, so the drill moves from adding entries to looking up specific values. Earlier rungs keep
coming back in later rounds, harder each time, and at higher levels problems start combining rungs
("count word frequencies, then return the most common"). A short note on each round says what moved
and why.

**Why this priority**: Incremental difficulty that walks the user through the domain is what makes
this a drill and not a problem generator.

**Independent Test**: Solve every rung 1 problem across rounds and confirm its level rises each round,
rung 2 opens with a lesson once rung 1 reaches the opening level, and the next round mixes both. Fail
every problem in a round and confirm the level drops by one.

**Acceptance Scenarios**:

1. **Given** a finished round, **When** the next round is generated, **Then** each open rung's level
   has moved automatically by the progression rule, with no confirmation step.
2. **Given** the newest open rung reaches the opening level, **When** the next round is generated,
   **Then** the following rung opens with a short lesson and the round includes its problems.
3. **Given** several open rungs, **When** a round is generated, **Then** most problems are on the
   newest open rung and the rest review earlier rungs at their current levels.
4. **Given** a level change, **When** the round note is shown, **Then** it states the change and the
   attempts that caused it.
5. **Given** the user overrides a verdict in a finished round, **When** the override is saved, **Then**
   that round's level changes are recomputed and the change is recorded, without rewriting rounds
   already generated.
6. **Given** a new round, **When** its problems are generated, **Then** none repeats a problem from
   earlier in the same drill.

---

### User Story 4 - See progress and come back later (Priority: P2)

The user reopens a drill days later from its node on the canvas. They see the ladder with each rung's
state (locked, open, solid) and level, how each level moved round by round, and the problems they got
wrong. They pick up where they left off or redo a failed problem.

**Why this priority**: Kaizen is improvement over time; it only works if the drill can be resumed and
the trend is visible.

**Independent Test**: Run three rounds, restart the app, reopen the drill from its canvas node.
Confirm the ladder state, level history and failed problems are intact and the next round continues
from them.

**Acceptance Scenarios**:

1. **Given** a drill with rounds, **When** the user opens it, **Then** each rung shows its state,
   current level, and level after each round.
2. **Given** a failed problem, **When** the user redoes it, **Then** a new attempt is added to that
   problem and counts toward the current round for its rung.
3. **Given** a drill, **When** it is reopened, **Then** the next round continues from the last
   recorded levels and open rungs.
4. **Given** the drill node on the canvas, **When** it is shown, **Then** it displays the domain and
   the newest open rung with its level.

---

### User Story 5 - Ask why, and branch out (Priority: P2)

The user gets a verdict they don't understand, or gets curious ("why must dict keys be hashable?").
They type a follow-up on the problem from the drill screen. It becomes a branch on the project canvas
leaving the drill node, carrying the problem, their attempt and the verdict as its context, and the
answer streams in as on any canvas node. The drill shows the follow-up as a link on that problem.
They can also highlight any drill text and Branch, Define or Park it as anywhere else. The drill's
state does not change.

**Why this priority**: Understanding mistakes is how the drill teaches, and putting follow-ups on the
canvas keeps what the user learned in the same map as the rest of their thinking. The drill still
works without it.

**Independent Test**: Ask a follow-up on a judged problem. Confirm a question edge and answer node
appear on the canvas leaving the drill node, the answer has the problem, attempt and verdict as
context, the problem links to it, and no level or round changed. Then highlight a phrase in a lesson
and branch, and confirm the same.

**Acceptance Scenarios**:

1. **Given** a problem on the drill screen, **When** the user sends a follow-up, **Then** a question
   edge (user-authored) leaving the drill node and an answer node (ai-suggested) are created on the
   canvas, and the problem shows a link to them.
2. **Given** a follow-up, **When** its answer is generated, **Then** it uses the problem, the
   attempt being asked about and its verdict as context, and records which problem and attempt
   these were.
3. **Given** any drill text, **When** the user highlights it, **Then** Branch, Define and Park are
   offered as on canvas text, and a branch leaves the drill node quoting that text.
4. **Given** a follow-up link on a problem, **When** the user follows it, **Then** the canvas opens
   focused on that branch, with a way back to the same problem.
5. **Given** a follow-up or branch from a drill, **When** it is created, **Then** no round, level,
   rung, attempt or verdict changes.

---

### User Story 6 - Ground a drill in my conversations and drill on from it (Priority: P3)

The user has been talking through dictionaries on the canvas. When starting or running a drill they
attach that conversation, so lessons and problems use the examples and confusions from it. When every
rung is solid, the drill says it is complete and offers the follow-ups the user asked during it, and
the attached conversations, as things to drill next. The user picks "why must keys be hashable?" and a
new drill starts from it, with a proposed domain they can edit.

**Why this priority**: It ties drills to the user's own thinking and keeps the kaizen loop going, but
a single drill is useful without it.

**Independent Test**: Attach a conversation to a drill and confirm the next round's generation records
it as an input. Mark every rung solid and confirm the completion offer lists only this drill's
follow-ups and attached conversations, at most 3. Pick one and confirm a new drill starts from it,
linked to that node and to the finished drill.

**Acceptance Scenarios**:

1. **Given** a drill, **When** the user attaches a conversation from the same project, **Then** later
   ladders, lessons and problems may draw on it, record that they did, and nothing is generated by the
   attachment itself.
2. **Given** an attached conversation, **When** the user detaches it, **Then** later generation stops
   using it and earlier records of its use are kept.
3. **Given** every rung is solid, **When** the round ends, **Then** the drill is marked complete and
   shows up to 3 starting points drawn only from its follow-ups and attached conversations, each
   ai-suggested and dismissible.
4. **Given** a starting point, **When** the user picks it, **Then** a new drill is created with an
   ai-suggested domain taken from that node, which the user can edit before the ladder is proposed, and
   its drill node is linked on the canvas to the source node and to the finished drill.
5. **Given** the completion offer, **When** the user dismisses it or ignores it, **Then** nothing is
   created, it is not shown again for that drill, and the finished drill can keep running review rounds.

---

### Edge Cases

- The domain is too vague to build a ladder for ("programming"): the AI proposes a ladder anyway and
  says it is broad; the user can narrow it. Nothing starts until the ladder has at least one rung.
- The domain is narrow enough for one rung: a one-rung drill is valid.
- An attempt is empty or off-topic: it is judged not solved, with feedback saying so.
- A generated problem is wrong or unsolvable: the user flags it; it is kept, excluded from
  progression, and a replacement can be added beside it.
- The AI fails partway through a round: problems already created stay; the user can retry the
  missing ones or end the round with what exists.
- A rung reaches level 10: it stays at 10, is marked solid, and keeps appearing in review.
- Every rung is open and solid: the drill is complete, shows the drill-on offer (FR-032), and can keep
  generating mixed review rounds at current levels; the user can add rungs, which reopens it.
- A drill completes with no follow-ups and no attached conversations: it says it is complete and
  offers nothing.
- An attached conversation is in the trash or in another project: it cannot be attached; one trashed
  after attaching stops being used, and its earlier use stays recorded.
- The user edits or reorders the ladder after rounds exist: history is kept; reordering affects only
  which locked rung opens next; a removed rung's history is kept and hidden and it gets no new
  problems.
- The user stops mid-round: the round stays open and resumes where they left off.
- The drill node is moved on the canvas or the project is trashed: the drill moves or is trashed and
  restored with it.

## Requirements *(mandatory)*

### Functional Requirements

#### Drills and the canvas

- **FR-001**: The user MUST be able to add a drill to a project by entering a domain as free text. A
  drill MUST NOT be created without that action.
- **FR-002**: On creation the AI MUST propose a ladder: an ordered list of rungs, each a named part of
  the domain, from basic to advanced. Rungs MUST be ai-suggested, and the user MUST be able to edit,
  reorder, remove and add rungs. The drill MUST NOT start until the ladder has at least one rung.
- **FR-003**: A drill MUST appear on the project canvas as exactly one drill node, of a new drill
  kind. Rounds, lessons, problems and attempts MUST NOT be drawn on the canvas.
- **FR-004**: Opening the drill node MUST open a dedicated drill screen for that drill, with a clear
  way back to the canvas at the drill node.

#### Rungs, lessons and levels

- **FR-005**: Each rung MUST have a state (locked, open, solid) and a level from 1 to 10. At start,
  rung 1 MUST be open at level 1 and all others locked.
- **FR-006**: When a rung opens, the drill MUST show a short ai-suggested lesson on it before its
  first problems, covering what the rung is and one worked example. The lesson MUST stay available
  from the rung afterwards.
- **FR-007**: The newest open rung reaching the opening level (level 4 by default) MUST open the next
  locked rung in ladder order. A rung reaching level 7 or more MUST be marked solid. Both thresholds
  MUST be drill settings.
- **FR-008**: Each level MUST be described to the generator in terms of its rung (more steps, fewer
  cues, edge cases, unfamiliar framing, combination with other rungs), so a level means the same
  thing from round to round within a drill.

#### Rounds and problems

- **FR-009**: A round MUST contain 3 to 5 problems by default; the user MUST be able to set the round
  size between 1 and 10 as a drill setting. The drill screen MUST present one problem at a time: the
  user submits an attempt, sees its verdict, and then moves to the next problem. Earlier problems in
  the round MUST stay reachable for another attempt, a hint or the solution.
- **FR-010**: With more than one open rung, at least half of a round's problems MUST be on the newest
  open rung, and the rest MUST review earlier open or solid rungs at their current levels.
- **FR-011**: From level 5, a problem MAY combine two open or solid rungs, and MUST be tagged with
  both.
- **FR-012**: Each problem MUST record its rungs, its level, its round and the earlier attempts that
  informed it. Problems MUST be ai-suggested and marked AI-generated wherever shown.
- **FR-013**: A new problem MUST NOT repeat an earlier problem in the same drill, and SHOULD target
  mistakes seen in the user's earlier attempts on that rung.
- **FR-014**: The user MUST be able to flag a problem as wrong or unsuitable. A flagged problem MUST be
  kept, excluded from progression, and replaceable by a new problem added beside it.

#### Attempts and verdicts

- **FR-015**: The user MUST be able to submit any number of attempts at a problem. Each attempt MUST
  be user-authored and MUST NOT be edited after submission.
- **FR-016**: Each attempt MUST receive an ai-suggested verdict (solved, partly solved, not solved)
  with feedback that refers to the attempt's own content.
- **FR-017**: The user MUST be able to override any verdict. Both MUST be kept, and the user's MUST be
  used for progression.
- **FR-018**: The user MUST be able to ask for a hint and to reveal a worked solution, both recorded
  against the problem. For progression, a problem's result MUST be its latest verdict, except that a
  revealed solution MUST count as not solved and a hinted solve as partly solved.

#### Progression

- **FR-019**: When a round ends, each rung's level MUST change automatically, with no confirmation
  step: up one if all its problems in the round were solved, unchanged if mixed, down one (not below
  1) if none were solved. A rung with no attempted problems in the round MUST stay unchanged.
- **FR-020**: Automatic level changes MUST be recorded as ai-suggested with the attempts that caused
  them, and each round MUST show a note listing what moved and why.
- **FR-021**: The user MUST be able to set any rung's level or state by hand, recorded as
  user-authored. A verdict override on a finished round MUST recompute that round's level changes as
  a new recorded change, without rewriting rounds already generated.
- **FR-022**: A round MUST end when every problem has a result or when the user explicitly ends it;
  unattempted problems MUST count as not attempted. The next round MUST be generated when the
  previous one ends.

#### Progress and history

- **FR-023**: The drill screen MUST show the ladder with each rung's state, current level and level
  after every round, and the open failed problems.
- **FR-024**: The drill node on the canvas MUST show the domain and the newest open rung with its
  level.
- **FR-025**: All drills, ladders, lessons, rounds, problems, attempts, verdicts, overrides, hints,
  reveals, flags and level changes MUST be kept and survive restarts. None MAY be deleted as a side
  effect of another action. A drill MUST be resumable from its last recorded state, including an
  unfinished round.

#### Integration

- **FR-026**: All text on the drill screen MUST support Branch, Define and Park. A branch MUST start a
  conversation on the canvas leaving the drill node and record the quoted text and its source. None
  of these actions, nor a follow-up (FR-030), MAY change the drill's state.
- **FR-027**: Drill AI work (ladder, lessons, problems, verdicts, hints, solutions) MUST run only as
  a consequence of a user action (creating the drill, starting it, submitting an attempt, ending a
  round, asking for a hint or solution, picking a starting point) and MUST use the reply model setting
  from Feature 006. Attaching or detaching a conversation MUST NOT trigger generation.
- **FR-028**: The drill kind and the drill's AI operations MUST be expressed as Feature 010 kind and
  function definitions, so adding one requires a definition, not a change to the runner.
- **FR-029**: A drill MUST belong to one project and MUST move, trash and restore with it.
- **FR-030**: Each problem MUST offer a follow-up box. Sending a follow-up MUST create, on the project
  canvas, a question edge from the drill node and its answer node, exactly as a branch would, with no
  chat kept inside the drill. Its context MUST include the problem, the attempt asked about and its
  verdict, and it MUST record which ones. The problem MUST list links to its follow-ups, and following
  one MUST open the canvas focused on it with a way back to the problem.

#### Grounding and drilling on

- **FR-031**: The user MUST be able to attach to a drill, and detach, any conversation in the same
  project, chosen by picking a node on the canvas; the conversation is the path from its tree's root
  to that node. The AI MUST read only the drill's own material and its attached conversations when
  writing the ladder, lessons and problems, and each generated item MUST record which attached
  conversations it read.
- **FR-032**: When every rung is solid, the drill MUST be marked complete and MUST show, once, up to 3
  ai-suggested starting points for new drills, chosen only from this drill's follow-up branches and its
  attached conversations. The offer MUST be dismissible, MUST NOT create anything on its own, and MUST
  NOT reappear for that drill after being dismissed. Adding a rung MUST reopen a complete drill.
- **FR-033**: Picking a starting point MUST create a new drill whose domain is ai-suggested from that
  node's text and editable before the ladder is proposed. The new drill node MUST be linked on the
  canvas to its source node and to the drill it came from.

### Key Entities *(include if feature involves data)*

- **Drill**: one domain being practiced in a project, shown as one drill node on the canvas; holds the
  user-authored domain, its settings (round size, opening and solid levels), its ladder, its attached
  conversations, whether it is complete, and, if it was started from a starting point, its source node
  and parent drill.
- **Rung**: one ordered part of the domain with a provenance state, a state (locked, open, solid), a
  current level and a lesson.
- **Lesson**: the short AI-written introduction shown when a rung opens.
- **Round**: an ordered batch of problems generated when the previous round ended, with the rung
  levels it was generated for and its note of what moved.
- **Problem**: an AI-generated practice item with its rungs, level, round and generation inputs; may
  be flagged.
- **Attempt**: the user's answer to a problem, immutable once submitted; may be hinted.
- **Verdict**: the AI's judgement and feedback on one attempt, plus an optional user override.
- **Follow-up**: a canvas branch leaving the drill node, started from a problem; links to the problem
  and attempt it asked about.
- **Attached conversation**: a link from a drill to a node on the project canvas whose root-to-node path
  the drill may read; records when it was attached and detached.
- **Starting point**: an ai-suggested offer, made on completion, to start a new drill from one of the
  drill's follow-ups or attached conversations; records whether it was picked or dismissed.
- **Level change**: a recorded move of a rung's level or state, automatic (ai-suggested) or by hand
  (user-authored), with the attempts behind it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can go from typing a domain to working on the first problem in under 1 minute,
  excluding AI generation time.
- **SC-002**: In a scripted run where every problem is solved, rung 1 rises one level per round, rung
  2 opens with a lesson in the round after rung 1 reaches level 4, and 100% of level changes cite the
  attempts behind them.
- **SC-003**: Across 10 consecutive rounds of one drill, no problem repeats.
- **SC-004**: A verdict is shown within 15 seconds of submitting an attempt in 95% of cases.
- **SC-005**: After a restart, reopening a drill from its canvas node shows the same ladder, levels,
  rounds and attempts, including an unfinished round, in 100% of test runs.
- **SC-006**: In owner use on "Python dictionaries", the drill reaches at least the third rung within
  5 rounds of consistently correct answers, and at least 4 of 5 rounds after round 1 feel "harder
  than the last in the parts I'd got right".

## Assumptions

- **Domains come from the user**: a domain is typed by the user or picked from the drill-on offer,
  which draws only on the drill's own follow-ups and attached conversations. Proposing drills from
  anywhere else on the map, or at any moment other than completion, is out of scope.
- **Free-text attempts**: attempts are written answers, including code typed as text. The AI judges
  code by reading it; running code or checking answers mechanically is out of scope.
- **Thresholds**: a 1 to 10 scale, opening the next rung at level 4 and marking solid at 7 are
  informed defaults, kept as drill settings so they can be tuned.
- **Progression rule**: up one, hold, down one is deliberately simple and observable, per Article VI.
  Planning may tune it, but it must stay derived from attempts, never from self-rating.
- **Automatic stepping and Article I**: automatic changes are applied immediately for flow but stay
  ai-suggested; the user's overrides and hand-set levels always win.
- **Single user**: Farabi is single-user and local; no sharing, leaderboards or streaks.
- **Spaced repetition**: scheduling reviews across days is out of scope; the user returns when they
  choose.
- **Out of scope**: drills suggested outside the completion offer; drills spanning projects; importing problem sets; timed
  drills; multiple choice; executing code; scoring beyond rung levels.
