# Research: Farabi Lexicon

Background research (prompt science, hover design, sources) is in `farabi-coord/research/lexicon.md`
and its doc. This file records the design decisions for this feature.

## R1. Data format for the registry

- **Decision**: JSON files under `src/shared/lexicon/data/`, one per slot, parsed by a Zod schema at
  module load; a `versions.lock.json` holds each term's version and a hash of its instruction.
- **Rationale**: Owner decision: repo data is the source of truth. JSON is plain data (diffable,
  exportable to the doc), bundles into the client, and the schema gives runtime validation.
  The lock turns "bump the version when the instruction changes" into a failing test.
- **Alternatives**: TypeScript modules (typed, but code rather than data); syncing from the Claude
  Doc (rejected by the owner); a DB table (no versioning in git, not needed for one user).

## R2. Where uses are recorded

- **Decision**: `properties.lexicon = [{id, v}]` on the question edge (what the user asked for) and on
  each answer (what its reply was sent). Absent when there are no terms.
- **Rationale**: Owner decision for the edge (FR-054 declared properties). The answer copy makes
  retries honest after an instruction change (spec clarification) at no extra cost: answers are
  inserted in the same place for every path (`insertPendingAnswer`).
- **Alternatives**: a side table (needs joins and a migration of its own); edge only (a retry after a
  version bump would misreport what was sent).

## R3. Sending an unsent edge with terms

- **Decision**: Migration `0013_lexicon` replaces `nodes_guard()` with the same function plus one
  extra allowance: during the existing "send" transition (unsent question edge gets text and
  sent_at), `properties` may change once, from `{}`. Everything else about properties stays immutable.
- **Rationale**: Branch and parked edges are created unsent; their message is written later in the
  composer like any other. Without this, those messages couldn't carry terms.
- **Alternatives**: forbid chips on send drafts (an inconsistent composer); a side table.
- **Merge note**: Kysely refuses to run a migration named before one already applied. Tauri's
  `0012_desktop` must be merged before, or together with, `0013_lexicon`, before the owner's DB is
  migrated.

## R4. Prompt placement

- **Decision**: `buildReplyRequest` pushes the lexicon block as the last system text block, after
  `REPLY_SYSTEM`, the branch context and the length guidance. The headless (Claude Code) form joins
  system blocks, so it gets the block too.
- **Rationale**: The block changes per message, so it goes last to keep the earlier blocks a stable
  prefix (research: "after the cached prefix"). Late placement also suits model attention.
- **Alternatives**: in the user message (would alter the verbatim text the model sees as the user's).

## R5. Selection rules shared by client and server

- **Decision**: One pure function, `checkSelection(ids)`, in the shared registry, used by the picker
  (availability reasons) and by the server (400 with the same reason). Single-value slots: operation,
  scope, format, tone, audience. Conflicts are declared on both terms; a test enforces symmetry.
  Max 6.
- **Rationale**: One rule set, no drift; conservative blocking per the spec.

## R6. Which messages' terms are sent

- **Decision**: Only the answered message's. `buildReplyInput` reads the answer's own `lexicon` uses
  (set from its parent edge) and resolves them to instruction texts.
- **Rationale**: Earlier messages' terms shaped earlier replies; repeating them would stack
  instructions, the main failure mode in the research.

## R7. Methods

- **Decision**: Three definitions, `premortem`, `steelman` (steelman, critique, synthesize) and `scqa`,
  each with an output kind of the same id (display `output`, accepts answers, no settings),
  procedure `propose`, version 1. The instructions follow Analogy's grounding rule: claims about the
  idea come from the text.
- **Rationale**: Owner decision (no runner change, keep it small). These three cover a risk method,
  an argument method and a structure method. OODA, Five Whys and Pyramid wait for feedback.

## R8. Hover card on the canvas

- **Decision**: In the composer, chips get a full React card (hover/focus, Escape, hoverable). On the
  canvas, a sent message shows a row of small chips in its bubble footer; each chip carries a native
  tooltip with name, slot, recorded version and the instruction text for that version when it is
  still current (otherwise "instruction changed since: vN now").
- **Rationale**: Canvas chrome is plain DOM in the text layer, imperative; a native title is the
  low-risk first step. A full canvas card can follow.

## R9. "Tested" for the launch set

- **Decision**: Automated: schema validity, unique ids/aliases, mutual conflicts, neighbours exist,
  instruction form (ends with a sentence, ≤ 400 characters, no shouting in capitals, no `<`), the lock,
  block snapshots, selection rules, and the output checks (`checks.ts`) against fixture outputs.
  Live model evals are a follow-up needing the owner's approval to spend calls.

## R10. Doc view

- **Decision**: `npm run lexicon:doc` prints markdown grouped by slot. Pasting into the Claude Doc is
  manual.
