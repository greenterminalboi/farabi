# Feature Specification: Farabi Lexicon

**Feature Branch**: `013-lexicon`

**Created**: 2026-10-07

**Status**: Draft

**Depends on**: Feature 010, Farabi v0.2 Message Graph and Canvas (`specs/010-v02-message-graph-canvas/`):
question edges and their declared properties (FR-054), the composer overlay, function definitions
and the generic runner (FR-045 to FR-053). Feature 012 (Drill Kaizen) contributed the context-role
hooks the reply context is built from.

**Input**: User description: "A versioned registry of prompting terms (repo data is the source of
truth; a Claude Doc is only a view) that the user adds to a message explicitly as term chips in the
composer (chip-only, no auto-detect). Launch with ~70 tested base terms: operations,
scope/format/tone/audience modifiers, strength words, quality checks. The question edge text stays
verbatim; the terms on the message go into a `<lexicon>` block in the reply system prompt after the
cached prefix; term ids and versions are recorded in the question edge's declared properties. Chip
hover card shows role, meaning, neighbours and the exact text sent. Slot rule: one value per
operation/scope/format/tone/audience slot, declared conflicts blocked, max 6 terms. A small set of
methods (Premortem, Steelman, SCQA) become function definitions next to analogy.ts with no runner
change."

> **Superseded in part (owner decision 2026-10-07)**: terms typed in the message are now picked
> up automatically as "detected" chips (on by default, with a setting to turn it off), and the
> six-term cap is gone. See Clarifications, "Owner decision 2026-10-07".

Research: `farabi-coord/research/lexicon.md` and its full write-up ("Farabi Lexicon: research").
Source vocabulary: the owner's "My AI Prompting Dictionary"; the rows used for the base set are
copied verbatim in [dictionary-extract.md](./dictionary-extract.md).

## Clarifications

### Owner decisions (made before this spec)

- Source of truth → the terms are versioned data files in the repository. The Claude Doc is only a
  readable view of them.
- Activation → chip-only. A term affects a reply only when the user explicitly adds its chip in the
  composer. Typed words are never detected or matched. *(Superseded by the owner decision of
  2026-10-07 below.)*
- Launch set → about 70 tested base terms: operations, scope, format, tone and audience modifiers,
  strength words and quality checks.
- Prompt → the question edge's text stays exactly as typed. The terms present go into a separate
  lexicon block in the reply instructions, after the stable (cached) part. Term ids and versions are
  recorded on the question edge as declared properties.
- Methods → become function definitions beside the existing Analogy function, with no change to the
  runner. The first release has at most a handful.

### Owner decision 2026-10-07: auto-detect

"Pick up any lexicon words at the moment and have a setting to turn them down." This supersedes the
chip-only activation above and the hard six-term cap below.

- Activation → as the user types, lexicon term names and aliases found in the text (whole words,
  any case; a typographic apostrophe counts as a straight one; no stemming, so "tables" is not
  "table") are added as chips marked "detected". Chips added by hand still work. The message text is
  stored and sent exactly as typed. Decided by lane: the alias "can" (May) is never detected, because
  most questions start "can you…"; every other name and alias is.
- Control (Article I) → detected chips look different from chips added by hand (dashed, labelled
  "detected"). Each can be removed before sending, and a removed term isn't picked up again for that
  draft even while its word stays in the text. The question edge records how each term arrived:
  `lexicon: [{ id, v, via: "detected" | "chip" }]`. Older rows without `via` stay valid; answers
  record only `{ id, v }`.
- Setting → "Pick up lexicon words automatically" (Settings → Lexicon), on by default, stored as an
  app setting in the append-only settings history (`lexicon_autodetect`, migration 0014), not an
  environment variable. Off is exactly the chip-only behaviour.
- Cap → none. Single-value slots and declared conflicts still apply, and the server still refuses
  them. Above eight terms the composer shows a soft warning; nothing is blocked.

### Session 2026-10-07 (decided by lane, owner to confirm)

The owner is away; each answer below is the most conservative reasonable option.

- Q: Which messages' terms reach a reply? → A: Only the terms on the message being answered. Terms
  on earlier messages in the path shaped earlier replies and are not repeated (FR-012).
- Q: What happens with two values for one slot, or a declared conflict? → A: Both are blocked in the
  composer: the conflicting term can't be added until the other is removed. There is no stated
  priority path in this release (FR-006, FR-007).
- Q: Is the six-term cap soft or hard? → A: Hard. A seventh term can't be added, and the server
  refuses a message with more than six (FR-008). *(Superseded by the owner decision of 2026-10-07:
  no cap, a soft warning above eight.)*
- Q: What happens with two values for one slot, or a declared conflict, among detected terms? → A:
  The first in text order is kept (a chip added by hand always beats a detected term), and the
  other is shown as a dimmed "conflicts with X" suggestion the user can swap in or dismiss.
- Q: Global or per project? → A: One global lexicon. Farabi is single-user; per-project overrides are
  out of scope.
- Q: Do strength words and "Top N" take a value (a number, the X and Y of "priority")? → A: No.
  Their instruction tells the model to apply the strength to the wording the user typed ("must",
  "at most 100 words"), so no term takes parameters in this release (FR-003).
- Q: What does "tested" mean for the launch set? → A: Every term passes automated checks of its
  data (unique ids and aliases, a known slot, neighbours and conflicts that exist and are mutual, a
  well-formed instruction) and of what it sends. Every term also declares its observable effect,
  with an automatic output check where one is possible (bullets, numbering, a table). Running those
  checks against a live reply model costs real AI calls and needs the owner's go-ahead, so it is a
  follow-up (FR-020).
- Q: Retry and regenerate after a term's instruction changed? → A: A new attempt uses the edge's
  term ids with the current instructions, and records the versions it actually sent on the answer.
  The edge keeps the versions recorded when it was sent (FR-014).
- Q: "????" quick branch re-asks a question. Does it keep the terms? → A: Yes. The re-asked edge
  copies the original edge's term ids, since it is the same question (FR-015).
- Q: Which methods ship first? → A: Three: Premortem, Steelman–critique–synthesize and SCQA. They
  run only on answers, like Analogy, and declare no settings (FR-017).
- Q: Does the hover card show a glyph? → A: Not in this release. It shows the role and slot, the
  meaning, an example, the neighbours and the exact text sent. Glyph templates are a follow-up.
- Q: How does the doc view stay in step with the repo? → A: A command prints the lexicon as a
  readable document from the repo data. Pasting it into the Claude Doc is a manual step (FR-021).
- Q: A term is later withdrawn: what happens to old messages? → A: Terms are never deleted, only
  retired. A retired term can't be added to new messages, but messages that used it still show it
  and its recorded version (FR-004).

### Constitution Check

| Article | How this feature meets it |
|---------|---------------------------|
| I. The User Is the Final Authority | Terms act only when they are on the draft as chips the user can see. Since the owner decision of 2026-10-07, terms typed in the text are added automatically as chips marked "detected" (a setting turns this off); each can be dismissed before sending and stays dismissed for that draft, and the edge records whether each term was detected or added by hand. The message text is stored and sent exactly as typed. The user can see the exact instruction each term sends before sending. Method outputs are ai-suggested and wait for the user's review like every function output. |
| II. Growth Is Additive, Never Reconciled | A message's terms are fixed when it is sent. Retries and re-asks add new attempts or edges; nothing existing is rewritten. Terms are retired, never deleted. |
| III. Nothing Is Invented Ahead of Evidence | Term instructions shape the form of a reply the user asked for (an allowed carve-out for explicit output-form instructions). Methods read only the answer's own text, every claim about the idea must come from it, and their outputs are marked AI-suggested. |
| IV. User-Led Exploration Takes Priority | No term or method is ever suggested by the AI. The picker opens only when the user asks, and methods run only when chosen. |
| V. Compression Preserves Meaning, Not Just Length | Scope terms (Distill, Condense, TL;DR) state what must be kept, not just a length. Each reply stays traceable to the term versions that shaped it. |
| VI. History Is Data, Not Decoration | Term ids and versions are recorded on every message and answer that used them. Terms are explicit instructions about output form; they are never treated as evidence about how the user learns. |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add term chips to a message (Priority: P1)

While writing a message, the user opens the term picker in the composer, searches "dist", and picks
Distill. A Distill chip appears in the composer. They add Bulleted list and Skeptic, and send. The
message's text is stored exactly as typed. The reply follows the three terms, and the sent message
shows the three chips it carried.

**Why this priority**: This is the core of the feature: a word the user picks reliably changes the
reply in the way the lexicon defines.

**Independent Test**: Send a message with two chips; check the stored text is unchanged, the reply
instructions contain a lexicon block with exactly those two terms and versions, and the edge records
them.

**Acceptance Scenarios**:

1. **Given** an empty composer, **When** the user picks Distill and Table and sends "What did the
   paper find?", **Then** the stored message text is exactly "What did the paper find?" and the
   message records Distill and Table with their versions.
2. **Given** a message with terms is sent, **When** the reply is generated, **Then** its instructions
   contain one lexicon block listing only those terms, in slot order, after the stable instructions.
3. **Given** a message without chips, **When** it is sent, **Then** the reply instructions contain no
   lexicon block and behave exactly as before this feature.
4. **Given** chips added to a draft, **When** the user switches to another element and back, **Then**
   the draft's chips are still there; once the message is sent, the chips are cleared with the text.
5. **Given** the picker is open, **When** the user types part of a term's name or alias
   ("elaborate"), **Then** the matching term (Expand) is listed and can be added with the keyboard
   alone.

---

### User Story 2 - See what a term will do before sending (Priority: P1)

The user hovers or focuses the Distill chip (or a term in the picker). A card shows its role and
slot, a one-line meaning, an example, its neighbours (Summarize, Condense) and the exact instruction
that will be sent to the model, with its version. From the card the user can remove the chip or swap
it for a neighbour.

**Why this priority**: Seeing the exact text sent is what makes the instructions trustworthy and is
how the user learns the difference between neighbouring words.

**Independent Test**: Hover a chip; the card's "sent to the model" text equals the instruction in
the lexicon block for that term.

**Acceptance Scenarios**:

1. **Given** a Distill chip, **When** the user hovers or focuses it, **Then** a card shows role,
   slot, meaning, example, neighbours, version and the exact instruction text.
2. **Given** the card is open, **When** the user picks the neighbour Summarize, **Then** the Distill
   chip is replaced by Summarize.
3. **Given** the card is open, **When** the user presses Escape or moves away, **Then** it closes; it
   stays open while the pointer is over it (hoverable, dismissible, persistent).
4. **Given** a sent message with chips on the canvas, **When** the user hovers one of its chips,
   **Then** a tooltip shows the term, its slot, the version that message recorded and its
   instruction (a full card on the canvas is a follow-up).

---

### User Story 3 - Slot rule and conflicts (Priority: P2)

The user has Concise in the scope slot and tries to add Comprehensive. The picker shows
Comprehensive as unavailable, with the reason ("Scope already set: Concise"). Verbatim and Simplify
are declared as conflicting, so the second can't be added either. There is no cap on the number of
chips (owner decision 2026-10-07); above eight the composer warns that long lists blur each other.

**Why this priority**: Stacked and conflicting instructions are the main way instruction following
collapses; blocking them keeps every reply's instructions coherent.

**Independent Test**: Try each blocked combination in the composer and through a direct request; both
refuse it with a clear reason.

**Acceptance Scenarios**:

1. **Given** a scope term is on the draft, **When** the user looks for another scope term, **Then**
   it is shown as unavailable with the reason and can't be added.
2. **Given** two terms declared as conflicting, **When** one is on the draft, **Then** the other is
   unavailable with the reason.
3. **Given** more than eight chips, **When** the user looks at the draft, **Then** a soft warning
   is shown and terms can still be added (owner decision 2026-10-07).
4. **Given** strength or quality terms, **When** several are added, **Then** they are allowed
   together (those slots take more than one value) unless a conflict is declared.
5. **Given** a request that breaks any of these rules or names an unknown or retired term, **When**
   it reaches the server, **Then** it is refused with a clear message and nothing is stored.

---

### User Story 4 - Run a method on an answer (Priority: P2)

On an answer about a launch plan, the user opens the function menu and picks Premortem. A function
edge and an AI-suggested Premortem output appear, which the user confirms or rejects, exactly like
Analogy. Steelman (steelman, critique, synthesize) and SCQA work the same way.

**Why this priority**: Named multi-step methods are the most valuable part of the dictionary that
isn't a one-line instruction, and the function machinery already exists.

**Independent Test**: Run each method on an answer with the fake provider; an output of the method's
kind appears under a function edge, marked proposed, with the method's version.

**Acceptance Scenarios**:

1. **Given** a complete answer, **When** the user opens its function menu, **Then** Premortem,
   Steelman and SCQA are listed beside Analogy.
2. **Given** the user runs Premortem, **When** it finishes, **Then** a Premortem output appears under
   a function edge, ai-suggested and proposed, recording the function's id and version.
3. **Given** a question edge or an output, **When** the user opens its function menu, **Then** no
   method is offered.
4. **Given** the AI is unavailable, **When** a method runs, **Then** nothing is stored and the user
   sees the error, as with Analogy.

---

### User Story 5 - The lexicon as a readable document (Priority: P3)

The owner runs one command and gets the whole lexicon (every term's slot, meaning, example,
neighbours, conflicts, version and exact instruction) as a readable document to paste into the
Claude Doc.

**Why this priority**: The doc is how the owner reads and discusses the vocabulary, but it is only a
view, so a simple export is enough.

**Independent Test**: Run the export; every active term appears once, grouped by slot, with its
instruction text identical to what is sent.

**Acceptance Scenarios**:

1. **Given** the registry, **When** the export runs, **Then** it lists every term grouped by slot
   with all its fields and marks retired terms.

---

### Edge Cases

- A message whose text is only "????" with chips: when it quick-branches, the re-asked edge keeps the
  original question's terms, not the chips on the "????" draft (the draft's chips are cleared).
- An unsent edge (from a branch or a parked tangent) gets its terms when it is sent from the composer.
- A term's instruction changes after a message was sent: the edge keeps its recorded version; a later
  retry sends the current instruction and records that version on the new answer.
- A term is retired after use: old messages still show its chip and recorded version, marked
  retired; it can't be added to new drafts.
- The terms' instructions include angle brackets or quotes: the lexicon block stays well formed.
- The highlighted passage of a branch and the lexicon block both appear: both are present, and the
  message text is unchanged.
- A scope term (Concise) and the global reply-length setting disagree: the term wins, because it is
  the user's explicit request for this message.
- The Claude Code headless provider: it receives the same lexicon block as part of its instructions.

## Requirements *(mandatory)*

### Functional Requirements

**Registry**

- **FR-001**: The lexicon MUST be a registry of terms kept as versioned data in the repository. Each
  term has a stable id, a display name, aliases, a role, a slot, a one-line meaning, an example,
  neighbours, declared conflicts, a version, the exact instruction sent to the model, and a
  description of its observable effect.
- **FR-002**: Slots MUST be operation, scope, format, tone, audience, strength and quality. Operation,
  scope, format, tone and audience take at most one term per message; strength and quality take
  several.
- **FR-003**: Each instruction MUST be calm and positive, say what to do, give a one-clause reason and
  state an output check where one applies. No term takes parameters; strength terms apply to the
  user's own wording.
- **FR-004**: Terms MUST never be removed from the registry. A withdrawn term is marked retired; any
  change to a term's instruction MUST come with a version increase, and an automated check MUST fail
  when the instruction changes without one.
- **FR-005**: The launch set MUST contain the base terms listed in the research (about 70: 26
  operations, 8 scope, 6 format, 5 tone, 5 audience, 11 strength, 8 quality), with meanings and
  examples drawn from the owner's dictionary.

**Composer**

- **FR-006**: The composer MUST let the user add and remove term chips on any draft (new tree, ask,
  send), through a searchable picker that matches names and aliases and works with the keyboard alone.
  Unless the user turns it off in Settings, terms named in the typed text are also added, as chips
  marked "detected" that the user can dismiss; a dismissed term stays off for that draft (owner
  decision 2026-10-07). When two detected terms clash by slot or declared conflict, the first in
  text order is kept and the other is offered as a "conflicts with X" suggestion.
- **FR-007**: The picker MUST show a term as unavailable, with the reason, when its slot is already
  filled on the draft or it conflicts with a term on the draft. Conflicts are declared in both
  directions.
- **FR-008**: There is no limit on the number of terms (owner decision 2026-10-07); above eight the
  composer shows a soft warning. The server refuses a message that breaks FR-002 or FR-007, or names
  an unknown, retired or repeated term.
- **FR-009**: Chips MUST be kept per draft with the draft's text and cleared only when the message is
  stored.
- **FR-010**: Hovering or focusing a chip or a picker entry MUST show a card with role, slot,
  meaning, example, neighbours, version and the exact instruction. The card is hoverable,
  dismissible with Escape and stays open while hovered. From a draft's chip, the user can remove it
  or swap it for a neighbour (subject to FR-007).

**Sending and replies**

- **FR-011**: The message text MUST be stored and sent exactly as typed. The terms MUST be recorded on
  the question edge as declared properties: each term's id and version, and (since auto-detect)
  `via`, whether it was detected in the text or added as a chip.
- **FR-012**: A reply MUST receive one lexicon block listing only the terms of the message it answers,
  ordered by slot (operation, scope, format, tone, audience, strength, quality) and then by id, so
  equal inputs give equal instructions. The block goes after the stable instructions, so the cached
  part is unchanged. Messages with no terms produce no block.
- **FR-013**: The block MUST tell the model the terms are the user's explicit request and that a term
  that sets length or scope takes precedence over the general length guidance.
- **FR-014**: Every answer MUST record the term ids and versions its reply actually used. Retries and
  regenerations use the edge's term ids with the current instructions.
- **FR-015**: A quick-branch re-ask MUST copy the term ids of the edge it re-asks.
- **FR-016**: Sent messages MUST show their terms on the canvas; hovering one shows the term, its
  slot and the version that message recorded, marked retired when it is.

**Methods**

- **FR-017**: Premortem, Steelman–critique–synthesize and SCQA MUST be function definitions beside
  Analogy, each with its own output kind, accepting answers only, with no change to the function
  runner.
- **FR-018**: Each method MUST read only the answer's own text; claims about the idea must come from
  that text, and the output is ai-suggested and reviewed like any function output.

**Quality and the view**

- **FR-019**: Automated checks MUST cover the registry data (unique ids and aliases across terms,
  known slot, neighbours and conflicts that exist and are mutual, well-formed instructions, version
  locks), the lexicon block for given terms, the slot and conflict rules on client and server, and
  the output checks against sample outputs.
- **FR-020**: Each term MUST declare its observable effect; where it can be checked by code (bullet
  count, numbered steps, a table, a leading one-line summary), the check MUST exist. Running checks
  against a live model is out of scope for this release.
- **FR-021**: A command MUST print the lexicon as a readable document for the Claude Doc view.

### Key Entities

- **Term**: one lexicon entry: id, name, aliases, role, slot, meaning, example, neighbours,
  conflicts, version, instruction, observable effect, retired flag.
- **Term use**: a term id and version recorded on a question edge (what the user asked for) and on an
  answer (what its reply was sent).
- **Method**: a function definition with its own output kind; its outputs are function outputs.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The launch set has at least 65 active terms, and 100% of them pass the registry checks.
- **SC-002**: For 100% of messages with terms, the stored text equals the typed text, and the
  instructions contain exactly the recorded terms, in slot order.
- **SC-003**: Messages without terms produce reply instructions identical to those before this
  feature.
- **SC-004**: A user can add a term by keyboard in at most 4 key presses after opening the picker
  (open, type a few letters, Enter).
- **SC-005**: 100% of blocked combinations (two in one slot, a declared conflict, a seventh term, an
  unknown or retired term) are refused in the composer and by the server.
- **SC-006**: The three methods appear in an answer's function menu and run end to end, adding no
  change to the function runner.
- **SC-007**: The hover card's instruction text matches the sent instruction for 100% of terms.

## Assumptions

- The reply prompt's stable instructions stay cacheable; only the lexicon block varies by message.
- One global lexicon (single user).
- The canvas's question bubbles can show a short row of chips without a layout change for messages
  that have none.
- No database migration is needed: question edges and answers already carry declared properties.
- Live, per-model evaluation of terms (research idea 7), neighbour swap as a sibling reply (idea 6),
  lens underlines, saved recipes, filtering the canvas by term and glyph templates are follow-ups.
