# Research: Drill Kaizen

Decisions for [plan.md](./plan.md). Each entry gives the decision, the reasons and the alternatives
that were rejected. Feature 010's research (R1–R18) is assumed throughout.

## R1. Where drill text is stored

**Decision**: lessons, problems, hints, solutions, attempts and verdicts are graph elements in
`nodes`, in the drill's own tree, with kinds marked as not drawn on the canvas. The mutable ladder,
levels and events go in separate drill tables (data-model.md).

**Rationale**:

- An attempt is something the user does and a verdict is AI content. That is exactly v0.2's
  question edge → answer node pair, so the provenance rules, immutability trigger (`nodes_guard`) and
  "nothing is deleted" guarantees apply with no new code.
- Branch, Define and Park all reference `nodes` ids and offsets into `nodes.text` (v0.2 FR-016,
  FR-055). Storing drill text there makes FR-026 work through the existing selection, anchor,
  definition and parked-tangent code, with no new reference columns.
- The ancestor-path context builder (v0.2 R6) gives a follow-up its context for free: the path from
  a verdict up to the origin is domain → problem → attempt → verdict (R3).

**Alternatives considered**:

- *Separate `drill_problems`, `drill_attempts` and similar tables.* Rejected. Definitions, parked
  tangents and branch anchors would each need a second kind of source reference, and the
  immutability and provenance rules would have to be rebuilt for each table.
- *Drill elements drawn on the canvas.* Rejected by the spec (FR-003).

## R2. Shape of a drill tree

**Decision**:

```text
drill_start edge (user_authored, text = domain)            origin 'origin', or 'drill' when started from a node
└─ drill node (user_authored, text = '')                   origin 'drill'        ← the only drill element drawn
   ├─ drill_round edge (ai_suggested)                      origin 'run', function drill_round
   │  ├─ drill_lesson node        (hidden)                 origin 'run'
   │  ├─ drill_problem node       (hidden)                 origin 'run'
   │  │  └─ drill_attempt edge    (user_authored, hidden)  origin 'ask'
   │  │     └─ drill_verdict node (ai_suggested, hidden)   origin 'run', function drill_verdict
   │  ├─ drill_hint node          (hidden)                 origin 'run'
   │  └─ drill_solution node      (hidden)                 origin 'run'
   └─ … one drill_round edge per round
follow-ups: ordinary question edges whose parent is a hidden node (R3)
```

- Hints and solutions are made with their problem in the same call. They are siblings under the round
  edge, linked by `properties.problemId`, because a content node's parent must be an edge. They are
  shown only after a hint or reveal event (R9).
- A drill started from a typed domain is a new tree. A drill started from a starting point (FR-033)
  puts its `drill_start` edge under the source node, in the source's tree, so the canvas draws the
  link (R12).

**Rationale**: everything uses v0.2's existing origins except one new value, `drill`, for the drill
node and for a `drill_start` edge that has a parent. Migration 0011 adds `drill` to the `nodes.origin`
CHECK. That is an additive change and is logged as a contract change (R15).

## R3. Where follow-ups and branches attach

**Decision**:

- A follow-up (FR-030) is an ordinary `question` edge whose parent is the verdict being asked about.
  If the problem has no attempt yet, the parent is the problem.
- A highlight-and-branch from drill text is an ordinary branch edge, anchored on that hidden node's
  text.
- The canvas draws any element whose parent is hidden as leaving the nearest drawn ancestor, which
  is always the drill node.

**Rationale**:

- The ancestor path then gives the reply the problem, the attempt and the verdict (FR-030), and
  `buildReplyInput` needs no drill-specific branch.
- Anchors stay valid offsets into a real element's text.
- The spec says the edge leaves the drill node. On screen it does; in storage its parent is the item
  it was asked about, which is what makes it traceable (Article V).

**Alternatives considered**: storing the parent as the drill node and putting problem and attempt
ids in properties. Rejected: context would then need a drill-specific path, and branch anchors
couldn't point into problem text.

## R4. Drill AI operations and FR-028

**Decision**:

- The drill's five AI operations are declared as data in `src/server/drill/operations/`, one file
  each: `drill_ladder`, `drill_round`, `drill_verdict`, `drill_offer` and `drill_domain`.
- Each has an id, version, instruction (system and prompt builders) and a zod output schema. They
  share the shape of `FunctionDefinition`'s `instruction` and `parse`.
- A small generic executor, `callOperation(op, input, settings)`, calls the provider, extracts JSON
  and validates it. The drill service decides where results are inserted.
- Every element they produce records `function_id` and `function_version`.

**Rationale**:

- v0.2's runner has one fixed procedure: one input node → function edge → one output.
- A round produces many outputs, a verdict attaches under an existing user edge, and a ladder
  produces rows rather than nodes. Forcing these through `runFunction` would mean adding procedures
  to the runner, which is v0.2's SC-013 guard.
- FR-028's intent is that new capabilities are added by declaration. Here every drill kind is a
  registry declaration, every operation is a data definition, and the executor never names one.
- Analogy and the runner are untouched.

**Alternatives considered**: generalizing the v0.2 runner with `procedure: "drill_round"` and
similar. Rejected: it puts drill knowledge in the runner and changes another lane's guarded file.

## R5. Getting structured output from the model

**Decision**:

- Each operation asks for one JSON object, described in the prompt with an example.
- The executor takes the first `{…}` block, ignoring any code fence, and validates it with the
  operation's zod schema.
- If it is invalid, the call is retried once with the validation error appended. If it fails again,
  `AIUnavailableError` is thrown and nothing is written (FR-052 pattern).

**Rationale**: it works the same on all three providers. The `claude-code` provider runs `claude -p`
with tools disabled and can't use API structured outputs.

**Alternatives considered**: API tool use or structured outputs. Rejected: only the `claude` provider
supports them, and the fake and `claude-code` providers would need a second path.

## R6. Model and effort

**Decision**:

- `CompletionInput` gains optional `model`, `effort` and `maxTokens` fields (a shared-file change,
  R15). When they are absent, `complete()` behaves exactly as today.
- Drill operations pass the reply model from Feature 6 (FR-027).
- Effort is `medium` for ladder, round and offer, and `low` for verdict and domain.
- `maxTokens` is 8,000 for a round and 2,000 otherwise.

**Rationale**:

- Today `complete()` is "one short, low-effort completion" at 4,000 tokens on the default model.
  A five-problem round with hints and solutions needs more room.
- FR-027 requires the user's chosen model.
- Low effort on verdicts helps meet SC-004 (≤ 15 s, p95).

## R7. Progression

**Decision**:

- `src/server/drill/progression.ts` holds pure functions with no database or AI access.
- `levelChanges(round, results, ladder, levels, settings)` returns the changes for FR-019 (up one,
  hold or down one) and the state transitions for FR-007:
  - open the next locked rung when the newest open rung reaches `open_level`
  - mark a rung solid at `solid_level`
  - mark the drill complete when every rung is solid
- `roundPlan(ladder, levels, settings)` returns how many problems go to each rung and at what level:
  - at least ⌈n/2⌉ go to the newest open rung (FR-010)
  - the rest are spread round-robin over the older open and solid rungs, lowest level first
  - a rung at level ≥ 5 is paired with another for a combined problem, at most one per round (FR-011)
- A problem's result (FR-018): the user override if there is one, otherwise the latest AI verdict.
  A revealed solution counts as `not_solved`, and a hinted solve counts as `partly_solved`.
- Flagged problems are left out.
- Thresholds are drill kind settings with per-drill overrides (R10).

**Rationale**: pure functions can be unit-tested exhaustively, which covers SC-002. The AI only fills
in the plan's slots and never chooses levels, which matches Article VI.

## R8. No repeated problems (FR-013, SC-003)

**Decision**:

- The round prompt includes every earlier problem in the drill, each cut to 300 characters, plus the
  user's most recent `not_solved` and `partly_solved` attempts with their verdict feedback, up to 6.
- After parsing, a problem whose normalized text matches an earlier one is rejected. Normalizing
  means lowercasing, collapsing whitespace and stripping punctuation.
- If any are rejected, the call is retried once. If it fails again, the round is created short and
  the round note says so.

**Rationale**: drills are small (10 rounds × 5 problems is about 15k characters of earlier
problems). Exact-match checking is deterministic and testable. Near-duplicates are left to the prompt.

## R9. Hints, solutions and judging

**Decision**:

- The round call writes each problem with a one-line hint and a worked solution.
- Hints and solutions are stored at once as hidden nodes and shown only after a `hint` or `reveal`
  event (FR-018).
- The verdict call is given the problem, the hidden solution as a reference, and the attempt. It
  returns `{verdict, feedback}`, and the feedback must quote or refer to the attempt (FR-016).

**Rationale**: there's no extra AI call on hint or reveal, so both are instant. Judging against a
reference answer is more consistent.

**Alternatives considered**: generating hints on demand. Rejected: it adds latency and a failure mode
for no gain.

## R10. Settings

**Decision**: the `drill` kind declares three settings:

- `round_size`: 1–10, default 4
- `open_level`: 2–9, default 4
- `solid_level`: 3–10, default 7, and greater than `open_level`, checked on save

v0.2's kind-settings resolution currently takes overrides only on function edges. It is generalized
to "the element the override is set on", so the drill node can hold per-drill overrides (R15).

## R11. One problem at a time (FR-009)

**Decision**:

- The current problem is derived, not stored. It is the first problem in round order that has no
  result, no `skip` event and is not flagged.
- Skips, hints, reveals and flags are rows in `drill_problem_events`.
- The client shows the current problem and a strip of the round's problems to reopen earlier ones.

## R12. Completion offer and drilling on (FR-032, FR-033)

**Decision**:

- When round-end progression marks the drill complete, the server gathers candidates:
  - question edges in the drill's tree whose path passes through a drill element (follow-ups and
    branches)
  - currently attached conversations
- If there are any, one `drill_offer` call picks up to 3 and writes a domain line for each.
  These are stored as an ai-suggested offer. With no candidates, no call is made.
- Picking a candidate opens the new-drill form with that domain prefilled (`drill_domain` is not
  called again). Creating the drill puts its `drill_start` edge under the source node, with origin
  `drill` and the domain text the user confirmed.
- `drills.parent_drill_id` records the drill it came from. The canvas shows "from ‹parent›" on the
  drill card.
- A drawn connector to the parent drill is not possible, because v0.2 has no cross-tree connectors.
  When the source is a follow-up of the parent, the tree already joins them visually.
- **Flag for the owner**: FR-033's "linked on the canvas to the drill it came from" is met as a label
  when the source is an attached conversation in another tree.

## R13. Branch, Define and Park on rung names

**Decision**: these apply to the text of lessons, problems, attempts, verdicts, hints and solutions.
Rung names are short, editable labels in the ladder, not elements, so they are excluded.

**Flag for the owner**: FR-026 says "all text on the drill screen". This plan narrows it to element
text. Making rung names elements would make them immutable, which conflicts with FR-002's editing.

## R14. The drill screen

**Decision**:

- A new route, `src/app/drill/[drillId]/page.tsx`, renders the drill screen as ordinary DOM. It has
  no canvas.
- Element text is rendered with v0.2's `RichText` and `render.ts` and given `data-node-id`, so
  `selection.ts` and the `SelectionToolbar` overlay work unchanged.
- "Back to canvas" navigates to `/?project=…&focus=<drillNodeId>`. A follow-up link navigates to
  `focus=<edgeId>` and carries `returnTo=/drill/<id>#<problemId>`.

**Rationale**: FR-004 asks for a separate screen. Reusing the text pipeline is what makes FR-026
cheap.

## R15. Changes outside the drill lane

The coordinator owns these files' contracts (farabi-coord/STATUS.md). Each change is additive and
will be logged there before the drill lane makes it, after rebasing onto committed v0.2:

| # | File(s) | Change |
|---|---------|--------|
| C1 | `src/shared/kinds/types.ts`, `index.ts` | `NodeKindDeclaration` gains `onCanvas?: boolean` (default true) and `contextRole?: "user" \| "ai"`. `Display` gains `"drill"` (shape node). |
| C2 | `src/server/graph/context.ts` | Builds turns from `contextRole` instead of the literal kinds `question` and `answer`. Existing kinds declare `question: user` and `answer: ai`, so behavior is unchanged. |
| C3 | `src/server/graph/canvas.ts`, `src/canvas/*` | Elements of kinds with `onCanvas: false` are not sent. A sent element whose parent is not sent gets `drawnFrom` = its nearest sent ancestor. Display `drill` draws a card from the canvas response's `drills` summary. |
| C4 | `src/server/ai/provider.ts`, `claude.ts`, `claudeCode.ts` | `CompletionInput` gains optional `model`, `effort` and `maxTokens`. |
| C5 | `src/server/ai/fake.ts` | `registerFakeCompletion(tag, fn)`, so drill operations get deterministic JSON in tests. |
| C6 | `src/server/settings/kindSettings.ts` | Overrides can be held on any element, not just function edges. |
| C7 | `src/server/db/migrationList.ts` | `"0011_drill": m0011`. The coordinator adds this when merging, per the 11:45 log entry. |

## R16. Testing with the fake provider

**Decision**:

- `src/server/drill/operations/fakes.ts` registers deterministic responders per operation tag (C5).
  - The ladder responder returns 5 rungs.
  - The round responder fills the plan with numbered problems.
  - The verdict responder returns `solved` when the attempt contains `✓`, `partly_solved` for `~`,
    and otherwise `not_solved`.
- Integration and e2e tests drive progression this way (SC-002, SC-003).

## R17. Depends on v0.2 milestones

**Decision**: work is planned in two phases.

- **D1, the drill core**: data, operations, progression and the drill screen. It needs v0.2 M1
  (migration 0010, `nodes`) and M2 (graph server) committed.
- **D2, integration**: canvas card, follow-ups and Define/Park on drill text. It also needs M4 (text
  layer) and M6 (functions, kind settings).

Until then the drill lane works on progression (pure), operations and their fakes, the migration
draft and the screen with mocked data.
