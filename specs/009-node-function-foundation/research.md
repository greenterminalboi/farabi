# Research: Node Function Foundation

No Technical Context item was left as NEEDS CLARIFICATION. The stack is unchanged and no new
dependencies are needed. The decisions below fit the spec to the existing code, its constitution
guards (`tests/integration/constitution.test.ts`) and the items the spec left to planning.

## R1. Node kind, origin and properties on the `nodes` table

- **Decision**: add columns to `nodes` rather than create a parallel table per kind.
  - `kind text NOT NULL`. Existing rows are backfilled as `conversation`; the default is then
    dropped, so every insert site names its kind.
  - `origin text NOT NULL`: `root`, `branch`, `quick_branch`, `parked` or `function`, with
    `function_id` and `function_version` required exactly when the origin is `function`.
  - `properties jsonb NOT NULL DEFAULT '{}'`, validated against the kind's declared property
    schema (strict: undeclared keys are rejected, FR-035).
  - `CHECK (kind = 'conversation' OR parent_id IS NULL)`. Outputs and pipes are never children,
    so they can never show up as branches, in the Branches panel, or in inherited context
    (FR-017; Feature 8's `directChildren` and `inheritedContext` already walk `parent_id`).
  - `kind` has no CHECK list. Kinds are declarations in code, and a DB list would make every new
    kind a migration (SC-007). The app validates kinds against the registry on insert.
- **Origin backfill**: `parent_id IS NULL` → `root`; child with a `parked_tangent_events.fired`
  row → `parked`; child whose incoming marker is `whole_message` → `quick_branch`; any other
  child → `branch`. The four insert sites (`trees.ts`, `branch.ts`, `quickBranch.ts`, the fire
  path via `insertBranch`) now pass their origin explicitly.
- **`isRoot`** becomes `kind === 'conversation' && parent_id === null`. The two server checks
  that treat "no parent" as "root" (`positions.ts`, `edgeLabels.ts`) switch to the same test. An
  output node can then be dragged on its own, and it has no edge label.
- **Provenance**: the existing `nodes.provenance` records how a node was created. Conversations
  stay `user_authored`. Output and pipe nodes are inserted `ai_suggested` (FR-028). Their current
  review state comes from the review events in R5 and is never written back onto the row.
- **Alternatives considered**:
  - A separate `outputs` table with its own ids, and no row in `nodes`, contradicts the
    clarification that everything in a tree is a node. It would also need a second position
    and drag path.
  - Deriving `origin` on read from markers and parked events has no place to record a function
    run. It would also be different code for every origin.

## R2. Where declarations live

- **Decision**: two registries, both plain data.
  - **Node kinds**: `src/shared/kinds/`, one file per kind plus `index.ts`. The client needs
    them too (view dispatch, map styling, generated settings sections), and they contain no
    server code. A declaration holds:
    - `id` and `label`
    - `conversationBacked`
    - `view` (a view id; see R9)
    - `mapLabel`: `summary` (Feature 1 rules) or `output_text`
    - `settings`: `SettingDeclaration[]`, each `{ key, label, help, type: 'choice',
      choices: [{ value, label }], default }`
    - `acceptsInputKinds`, for kinds produced by a function
    - `properties`: a strict zod object
  - **Functions**: `src/server/functions/definitions/`, one file per function plus `index.ts`.
    These are server-only because they hold the instruction text. A definition holds:
    - `id`, `version`, `name`
    - `accepts`: the input kinds
    - `reads`: `summary`, `conversation` or `anchor`
    - `outputKind`
    - `procedure: 'propose'`, the only procedure in this feature: the output is `ai_suggested`
      and waits for review
    - `instruction`: `{ system, prompt(source, settings) }`
    - `parse(text)`, which returns the cleaned output or throws
  - The client sees functions only through the availability endpoint (contracts/http-api.md).
- **Extensibility**: each registry is a `Map` built from its `index.ts` list, with a
  `register…()` export that tests use. SC-006 registers a test-only function and SC-007 a
  test-only kind, and neither test touches the runner, the settings page or the map.
- **Alternatives considered**: storing definitions in database tables. That would be data in the
  literal sense, but it needs an admin UI and migrations for instruction text. User-authored
  functions are out of scope.

## R3. The generic runner and the AI boundary

- **Decision**: `src/server/functions/runner.ts` exports `runFunction(functionId, inputNodeId)`
  and `regenerateOutput(outputNodeId)`. Neither contains a function-specific branch.
  1. Load the input node, its tree and its project, and reject a trashed project with 404
     (FR-013).
  2. Check the node's kind is in `def.accepts`, else 409 `wrong_kind`.
  3. Read the input through the reader for `def.reads` (R4). No readable source gives 409
     `function_unavailable` with the reader's reason (FR-010).
  4. Resolve the output kind's settings (R7). A first run has no node yet, so it uses the
     kind-level value or the default. A regeneration also applies the output node's own override.
  5. Call `provider.complete({ tag: def.id, system, prompt, signal })`, then `def.parse`.
  6. Only on success, write everything in one transaction:
     - output node
     - pipe node
     - `pipes` row
     - first version (for a regeneration, only a new version)
- **Provider boundary**: `AIProvider` gains one generic method, `complete(input:
  CompletionInput): Promise<string>`, a single-shot, low-effort text completion.
  - It is implemented once per provider: `claude.ts` (messages.create), `claudeCode.ts`
    (`runHeadless`) and `fake.ts`.
  - The fake returns `Fake <tag> #<n>` with a counter, so regenerations differ, and it records
    each call for tests.
  - With this method, adding a function touches neither the runner nor any provider (FR-008,
    SC-006).
  - The existing Article IV guard still holds: the runner lives outside `src/server/ai` and never
    calls `.reply(`.
- **Synchronous request**: the POST waits for the completion and returns the created output. The
  alternative is a background queue like definitions. The synchronous request makes FR-012
  simple: a failure is a 503 with nothing written, and the menu shows the error with Retry.
  - Summary-sized completions take a few seconds on the API (SC-002: 10 s).
  - A navigation away doesn't cancel the server work, and the map's poll picks up the result.
  - No partial row can exist, because the only writes happen after the completion succeeds.
- **Summary changes during a run**: the source version is captured in step 3, before the AI call.
  If the summary changes during the call, the new output is correctly stale the moment it lands
  (spec edge case).

## R4. Readers and summary versions

- **Decision**: `src/server/functions/readers.ts` maps each part to a reader:
  `read(nodeId) → { text, version } | { unavailable: reason }` and a bulk
  `currentVersions(nodeIds) → Map<nodeId, version>`.

  | Part | Text | Version | Unavailable when |
  |------|------|---------|------------------|
  | `summary` | latest `node_summaries.text` | that row's `id` | no summary row (placeholder), reason "This conversation has no summary yet: it needs a completed AI reply." |
  | `conversation` | live, complete messages as a transcript | last such message's `id` | no complete messages |
  | `anchor` | incoming marker's `anchor_text` | the marker's `id` | the node is a root |

- **FR-020 needs no new column**: `node_summaries` is already insert-only. Every regeneration adds
  a row, so the latest row's id is a version identifier that changes whenever the summary is
  regenerated. The migration adds an append-only trigger to `node_summaries` to make that a
  guarantee rather than a convention. Nothing updates or deletes summaries today, and the test
  TRUNCATE doesn't fire row triggers.
- **Staleness** (FR-022, SC-004): an output is stale when its latest version's `source_version`
  differs from the reader's current version for the pipe's input. The forest load computes this
  in SQL through `currentVersions`, with no AI call. It reflects stored summaries, so with
  `SUMMARY_TRIGGER=map` the badge appears once the map's stale-summary refresh has written the
  new summary.
- Only `summary` is used by a shipped function. `conversation` and `anchor` are implemented,
  because FR-007 makes them part of the definition contract and the SC-006 test definition
  exercises `anchor`.

## R5. Output versions and review

- **Decision**: two append-only tables, following the definitions pattern (versions) and the
  parked pattern (events).
  - `function_output_versions`: one row per generation. It records the text, the
    `source_version`, the function version and the resolved settings, always as `ai_suggested`.
  - `function_output_events`: one row per user action.
    - `confirmed` (with a `version_id`, `user_confirmed`)
    - `rejected` (`user_authored`)

    A composite FK keeps a confirmed version on its own output.
- **Derived state** (one function in `src/server/functions/state.ts`, used by forest, view and
  API):
  - `review`: the latest event's kind, or `proposed` when there is none.
  - `confirmedVersion`: the version of the latest `confirmed` event.
  - `displayed`: the confirmed version when `review = confirmed`, otherwise the latest version.
    A confirmed text is therefore never replaced by a regeneration (FR-026, SC-005).
  - `pendingDraft`: the latest version when `review = confirmed` and it is newer than the
    confirmed one.
  - `stale`: see R4. It is computed on the latest version, so regenerating clears the badge while
    the draft waits beside the confirmed text.
- **Actions**:
  - Confirm is allowed only on the latest version (409 `not_latest`). Confirming a pending draft
    replaces the displayed text, and that confirmation is the user's action.
  - Reject hides the output and its pipe. Confirming a rejected output later restores it: the
    latest event wins, and no event is ever removed.
  - Regenerate is allowed in any state. The UI offers it beside the stale badge.
- **Alternatives considered**:
  - Updating `nodes.provenance` on confirm would be a mutable row with no history (Articles I
    and VI).
  - Copying a version on confirm as definitions do works, but it duplicates text. Here an event
    that points at the version says the same thing.

## R6. Pipes

- **Decision**: a pipe is a `nodes` row of kind `pipe` in the input's tree, with no parent, plus
  an immutable `pipes` row: `node_id`, `input_node_id`, `output_node_id` (UNIQUE), `reads`,
  `function_id`, `function_version`, and `CHECK (input_node_id <> output_node_id)`.
- **Direction and immutability** (FR-015): no route writes `pipes`, and an append-only trigger
  blocks UPDATE and DELETE, so a pipe can never be reversed or re-pointed. Dragging an output
  changes only its `manual_x` and `manual_y`.
- **State** (FR-014): the pipe's procedure state is the output's `review` (`proposed`,
  `confirmed` or `rejected`). There is one source of truth, and the two can't disagree.
- **Versions shown on selection** (FR-017): the function id and version, the number of output
  versions, the source version, and whether the output is stale.
- **Map payload**: pipes are returned in their own `ForestResponse.pipes` array rather than mixed
  into `nodes`. Everything that iterates `nodes` today (graph, layout, sprites, test helpers)
  means "boxes", and pipes are connectors.

## R7. Kind settings and per-node overrides

- **Decision**: one append-only table, `kind_setting_changes`: `kind`, `key`, `node_id` (null
  means kind level), `value jsonb` (null means cleared), `user_authored`, `created_at`.
  - **Resolution** (FR-030): node override, then kind-level value, then declared default. For each
    scope, the newest row wins, and a null value means "not set at this scope".
  - **Validation**: `key` must be declared by `kind`; `value` must be one of its choices; and a
    `node_id` must be a node of that kind (FR-033).
  - **No run on change** (FR-032, SC-008): a save only inserts a row and never imports the
    runner. Each output version stores the settings it used, so the effect on later runs is
    visible.
  - **Location**: `src/server/settings/kindSettings.ts`. The Feature 6 guard allows only
    `src/server/settings` to mention `setting_changes`, which also matches this table.
  - Feature 6's global settings are untouched (spec assumption).
- **Analogy settings** (FR-034):

  | Key | Choices | Default |
  |-----|---------|---------|
  | `reach` ("How far afield") | `close` (a neighbouring field), `everyday` (everyday life), `far` (a distant, surprising domain) | `everyday` |
  | `length` ("Length") | `one_line` (one sentence), `short` (two or three sentences), `paragraph` (one paragraph, about 120 words at most) | `short` |

- **Article VI**: these are explicit instructions about the form of AI output, which the 1.0.1
  carve-out allows. They are never read by anything except the runner's instruction, and a guard
  test keeps the rule.
- **Which node an override belongs to**: an override lives on a node of the declaring kind, which
  here is an analogy node. It affects that node's regenerations. A new Analogy run creates a new
  node, so it always starts from the kind-level value (US5 AS2–AS3).

## R8. The Analogy instruction (Article III)

- **Decision**: the input is the summary sentence only, never the conversation or general topic
  knowledge.
- **System**: "You write one analogy that helps a person grasp an idea from their own learning
  notes. You are given a one-sentence summary of where one of their conversations ended up.
  Explain that idea by comparing it to {reach}. Every claim about the idea must come from the
  summary. Don't add facts, conclusions or opinions it doesn't contain. The analogy is an aid to
  understanding, not a new insight. Write {length}. Reply with only the analogy."
- The prompt wraps the summary in `<summary>` tags.
- `parse` trims the text, strips wrapping quotes and collapses whitespace. Empty text is an
  `AIUnavailableError`.
- **Article III**: an analogy necessarily borrows its comparison domain from general knowledge.
  The instruction anchors every claim about the idea to the user's own summary. The output is
  always shown as AI material: the "AI · Analogy" tag, a tentative outline and pipe until
  confirmed, and it is never styled like a user-authored node.

## R9. Views: what "clicking" opens

- **Decision**: the open gesture stays what Feature 2 made it. A single click selects a node, and
  a double-click opens it (zoom in, then navigate). Only what opens depends on the kind (FR-004).
- `/n/[nodeId]` becomes a server component that reads `nodes.kind` and renders the component
  registered for that kind's `view`, from `src/components/kinds/views.tsx`.

  | View id | Component | Used by |
  |---------|-----------|---------|
  | `chat` | `ChatView`, unchanged | conversation |
  | `output_beside_input` | `OutputView`: output text and review on the left; the input's summary and read-only conversation on the right, with "Open conversation" | analogy |
  | `pipe` | `PipeView`: the same details as the map's pipe card, full page | pipe |

- A new kind reuses one of these view ids by declaration. Only a new kind of view needs a
  component.
- **Guards on conversation endpoints**: every endpoint that only makes sense for a
  conversation-backed kind rejects other kinds with 409 `wrong_kind` (FR-005). These are send,
  branch, park, capture a definition, summary refresh and `GET /api/nodes/{id}` (`NodeView`).
  `OutputView` never renders the highlight toolbar, so Branch, Define and Park aren't offered
  there.
- **The home redirect** (`src/app/page.tsx`) picks the latest conversation node, not the latest
  node of any kind.
- **Input side of the view**: the full conversation, read-only, as the spec assumes. It reuses
  `Message` with the toolbar and markers disabled. The fallback (summary only) wasn't needed: a
  node view load is already fast enough for Feature 1's 1-second target.

## R10. Map rendering

- **Output boxes**: drawn with the same sprite as conversations, with these differences:
  - **Header**: the tag reads "AI · Analogy" (the kind's label), and the label is the displayed
    version's text (FR-018).
  - **Outline**: dashed while `proposed`, solid once `confirmed`. The fill is tinted with the AI
    colour so it never looks user-authored.
  - **Stale**: a "Stale · ↻ Regenerate" pill sits at the top right. Clicking it calls
    `onRegenerate(id)`, and MapHost posts the regeneration and refreshes (FR-023).
  - **Pending draft**: a small "New draft" dot.
  - **Rejected**: not drawn by default. A "Show rejected" toggle in the map corner, kept per
    browser in `settingsStore`, draws rejected outputs and pipes faded.
- **Pipes**:
  - **Shape**: drawn from the input box's right edge to the output box's left edge as a
    horizontal cubic. Parent-child edges are vertical and grey, so the two can't be confused
    (FR-016).
  - **Colour and state**: the AI colour, with an arrowhead at the output. A proposed pipe is
    dashed (segmented along the curve, since Graphics has no dash) at 60 % alpha; a confirmed
    pipe is solid.
  - **Hit-testing**: `edgeAt` tests pipes before parent-child edges. A pipe hit calls
    `onPipeClick(pipeId, screen)`, and MapHost shows `PipeCard`. A parent-child hit still opens
    the edge-label editor.
- **Function menu on the map**: the renderer gains `onNodeSelect(id | null, screenRect)`. On a
  conversation node, MapHost shows a small "Functions" button beside it, which opens
  `FunctionMenu`. After a successful run it refreshes at once rather than waiting for the 3 s
  poll, and selects the new output (SC-002).
- **Test hooks**: `__farabiMapDebug` nodes gain `kind`, `review`, `stale` and `pendingDraft`, and
  it gains a `pipes` list. New `__farabiMapPipePoint(pipeId)` and `__farabiMapBadgePoint(nodeId)`
  helpers mirror `__farabiMapEdgePoint`.
- **Diffing**: `diffForest` also treats as changed an output's display text, review, stale flag,
  a pipe added, and a pipe's state. The first three need a label update or redraw, and a new
  output or pipe marks its tree changed.

## R11. Placing outputs (FR-039)

- **Decision**: `layoutTree` places outputs after the tidy layout as satellites of their input.
  1. The candidate spot is to the right of the input:
     `x = input.x + NODE_WIDTH + SATELLITE_GAP`, `y = input.y`.
  2. The k-th output of the same input is stacked below the previous one.
  3. While the candidate box overlaps any box already placed in this tree, it steps right by
     one column.
- A hand-placed output (`manual`) keeps its position, as any node does. Tree boxes include
  outputs, so Feature 1's rule still holds: only a changed tree can move, and only when it isn't
  user-placed. No other tree and no hand-placed node moves.
- It is deterministic, local to one tree, and O(outputs × nodes in the tree): trivial at the
  SC-009 scale.
- **Alternative considered**: having the server pick and persist a position at creation. It
  would duplicate the client's layout knowledge, box heights included, and would turn every
  output into a hand-placed node from birth.

## R12. The function menu in chat view

- `NodeHeader` gains a "Functions" button that opens the same `FunctionMenu` component.
- The menu loads `GET /api/nodes/{id}/functions`. Only functions that accept the node's kind are
  listed (FR-009). Each is either runnable or disabled with its reason (FR-010, US1 AS3).
- A run shows "Working…" and then either:
  - "Analogy ready · Open" (a link to `/n/{outputId}`), or
  - the error message with Retry (FR-012).
- The Branches panel is unchanged. Outputs aren't children, so they never appear there.

## R13. Migration numbering and branch

- `0008_drop_span_suggestions.ts` exists as uncommitted work on `009-bold-underlines`, so this
  feature's migration is `0009_node_functions.ts`. This feature should branch from `main` after
  that work merges. The spec directory is `specs/009-node-function-foundation`, and the numbering
  overlap with the bold-underlines branch name is cosmetic.

## R14. Test strategy

- **Unit**:
  - setting resolution: all 3 levels, clears and overrides after a kind-level change
  - review and display state derivation (R5)
  - satellite placement (never overlaps, never moves manual or other trees)
  - registries (strict properties, unknown keys rejected)
  - the Analogy prompt builder and parse
  - `KindSettingsSections` rendering a test-only kind with jsdom (SC-007)
- **Integration** (`tests/integration/f9-functions.test.ts`):
  - run, unavailable, fail-creates-nothing, cross-project, stale without AI calls
  - regenerate keeps history
  - confirmed text is kept on regeneration
  - reject hides and keeps the record
  - settings resolution with 0 runs on save
  - the migration backfill
  - a test-only function registered with no runner change (SC-006)
- **Constitution guards** (extended):
  - Versions, events, pipes and `kind_setting_changes` are append-only, with no
    update or delete in `src`.
  - Every output version is `ai_suggested`.
  - Only `src/server/functions` calls `.complete(`, and no module in `src/server/ai` inserts
    nodes (already guarded).
  - Only the runner module writes output nodes.
  - `src/server/settings` never imports the runner.
- **E2E** (`tests/e2e/f9-node-functions.spec.ts`):
  - run from the map and from chat
  - output and pipe visible, with pipe distinct from edges
  - open the side-by-side view
  - pipe card
  - confirm and reject
  - stale badge after steering, then Regenerate
  - the settings section, and an override on a node
- `tests/e2e/helpers.ts` `resetDb` and `tests/integration/setup.ts` TRUNCATE lists gain the new
  tables.
