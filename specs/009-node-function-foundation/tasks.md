---
description: "Task list for Node Function Foundation"
---

# Tasks: Node Function Foundation

**Input**: design documents in `specs/009-node-function-foundation/`: [spec.md](./spec.md),
[plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/http-api.md](./contracts/http-api.md),
[contracts/declarations.md](./contracts/declarations.md), [contracts/ui.md](./contracts/ui.md)
and [quickstart.md](./quickstart.md).

**Tests**: included, as in earlier features. The quickstart scenario numbers ("QS n") map to the
test tasks.

**Format**: `[ID] [P?] [Story] Description`. `[P]` means the task can run in parallel, because it
touches different files and has no unfinished dependencies.

**Before starting**: the Feature 5 rework (`0008_drop_span_suggestions.ts`, currently uncommitted
on `009-bold-underlines`) must be merged to `main`. Branch `009-node-function-foundation` from
`main` after that (research R13).

---

## Phase 1: Setup

- [X] T001 Create the migration `src/server/db/migrations/0009_node_functions.ts`, per
  data-model.md. Follow `0007_parked_tangents.ts`: forward-only, with a `down()` that throws.
  1. **`nodes`**: add these columns:
     - `kind text NOT NULL DEFAULT 'conversation'`
     - `origin text`
     - `function_id text`
     - `function_version integer`
     - `properties jsonb NOT NULL DEFAULT '{}'`
  2. **Backfill `origin`** (research R1), in this order:
     1. `UPDATE nodes SET origin = 'root' WHERE parent_id IS NULL`
     2. `'parked'` where `id IN (SELECT child_node_id FROM parked_tangent_events WHERE kind = 'fired')`
     3. `'quick_branch'` where `id IN (SELECT child_node_id FROM branch_markers WHERE kind = 'whole_message')`
        and origin is still null
     4. `'branch'` for the rest
  3. **Constraints on `nodes`**:
     - `ALTER COLUMN kind DROP DEFAULT`
     - `ALTER COLUMN origin SET NOT NULL`
     - `CHECK (origin IN ('root','branch','quick_branch','parked','function'))`
     - `CHECK ((origin = 'function') = (function_id IS NOT NULL AND function_version IS NOT NULL))`
     - `CHECK (jsonb_typeof(properties) = 'object')`
     - `CHECK (kind = 'conversation' OR parent_id IS NULL)`
     - `CREATE INDEX nodes_kind_tree ON nodes (tree_id, kind)`
  4. **`CREATE TABLE pipes`** with these columns:
     - `node_id uuid PRIMARY KEY REFERENCES nodes(id) ON DELETE RESTRICT`
     - `input_node_id uuid NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT`
     - `output_node_id uuid NOT NULL UNIQUE REFERENCES nodes(id) ON DELETE RESTRICT`
     - `reads text NOT NULL CHECK (reads IN ('summary','conversation','anchor'))`
     - `function_id text NOT NULL`
     - `function_version integer NOT NULL`
     - `created_at timestamptz NOT NULL DEFAULT now()`

     Add `CHECK (input_node_id <> output_node_id)` and
     `CREATE INDEX pipes_by_input ON pipes (input_node_id)`.
  5. **`CREATE TABLE function_output_versions`** with these columns:
     - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
     - `output_node_id uuid NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT`
     - `text text NOT NULL CHECK (btrim(text) <> '')`
     - `source_version uuid NOT NULL`
     - `function_version integer NOT NULL`
     - `settings jsonb NOT NULL`
     - `provenance provenance NOT NULL DEFAULT 'ai_suggested' CHECK (provenance = 'ai_suggested')`
     - `created_at timestamptz NOT NULL DEFAULT now()`

     Add `UNIQUE (id, output_node_id)` and
     `CREATE INDEX output_versions_latest ON function_output_versions (output_node_id, created_at DESC, id DESC)`.
  6. **`CREATE TABLE function_output_events`** with these columns:
     - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
     - `output_node_id uuid NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT`
     - `kind text NOT NULL CHECK (kind IN ('confirmed','rejected'))`
     - `version_id uuid`
     - `provenance provenance NOT NULL`
     - `created_at timestamptz NOT NULL DEFAULT now()`

     Add these table constraints:
     - `CHECK ((kind = 'confirmed') = (version_id IS NOT NULL))`
     - `CHECK ((kind = 'confirmed' AND provenance = 'user_confirmed') OR (kind = 'rejected' AND provenance = 'user_authored'))`
     - `FOREIGN KEY (version_id, output_node_id) REFERENCES function_output_versions (id, output_node_id)`

     Add `CREATE INDEX output_events_latest ON function_output_events (output_node_id, created_at DESC, id DESC)`.
  7. **`CREATE TABLE kind_setting_changes`** with these columns:
     - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
     - `kind text NOT NULL`
     - `key text NOT NULL`
     - `node_id uuid REFERENCES nodes(id) ON DELETE RESTRICT`
     - `value jsonb`
     - `provenance provenance NOT NULL DEFAULT 'user_authored' CHECK (provenance = 'user_authored')`
     - `created_at timestamptz NOT NULL DEFAULT now()`

     Add `CREATE INDEX kind_settings_latest ON kind_setting_changes (kind, key, node_id, created_at DESC, id DESC)`.
  8. **Append-only triggers**: create `node_functions_append_only()`, which raises
     `'% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP`. Attach it with a trigger
     `<table>_append_only` BEFORE UPDATE OR DELETE FOR EACH ROW to these tables: `pipes`,
     `function_output_versions`, `function_output_events`, `kind_setting_changes` and
     `node_summaries`.
- [X] T002 Update `src/server/db/schema.ts`.
  - **`NodesTable`** gains:
    - `kind: string`
    - `origin: NodeOrigin`, with
      `export type NodeOrigin = "root" | "branch" | "quick_branch" | "parked" | "function"`
    - `function_id: string | null`
    - `function_version: number | null`
    - `properties: ColumnType<Record<string, unknown>, string | undefined, never>`, inserted as a
      JSON string
  - **`PipesTable`**: `reads: SourcePart`, with
    `export type SourcePart = "summary" | "conversation" | "anchor"`.
  - **`FunctionOutputVersionsTable`**:
    - `settings: ColumnType<Record<string, string>, string, never>`
    - `provenance: ColumnType<Provenance, never, never>`
  - **`FunctionOutputEventsTable`**: `kind: "confirmed" | "rejected"`, `version_id: string | null`.
  - **`KindSettingChangesTable`**:
    - `value: ColumnType<unknown, string | null, never>`
    - `provenance: ColumnType<Provenance, never, never>`
  - Register the four new tables in `Database`.
- [X] T003 Run `npm run db:migrate` and `npm run db:migrate -- --test`. Add
  `kind_setting_changes, function_output_events, function_output_versions, pipes` to the start of
  both TRUNCATE lists, in `tests/integration/setup.ts` and in `tests/e2e/helpers.ts` (`resetDb`).

---

## Phase 2: Foundational (blocks all stories)

- [X] T004 [P] Create the kind registry in `src/shared/kinds/` per contracts/declarations.md.
  - **`types.ts`**: `SettingDeclaration`, `ViewId = "chat" | "output_beside_input" | "pipe"` and
    `NodeKindDeclaration`.
  - **`conversation.ts`**: `id "conversation"`, label `"Conversation"`,
    `conversationBacked: true`, `view: "chat"`, `mapLabel: "summary"`, `settings: []`,
    `properties: z.object({}).strict()`.
  - **`analogy.ts`**: `id "analogy"`, label `"Analogy"`, `conversationBacked: false`,
    `view: "output_beside_input"`, `mapLabel: "output_text"`,
    `acceptsInputKinds: ["conversation"]`, `properties: z.object({}).strict()`. It declares two
    settings:
    - **`reach`** ("How far afield", help "Where the comparison is drawn from"):
      - `close`: "A neighbouring field"
      - `everyday`: "Everyday life" (default)
      - `far`: "A distant, surprising domain"
    - **`length`** ("Length"):
      - `one_line`: "One sentence"
      - `short`: "Two or three sentences" (default)
      - `paragraph`: "A paragraph"
  - **`pipe.ts`**: `id "pipe"`, label `"Pipe"`, `conversationBacked: false`, `view: "pipe"`,
    `mapLabel: "none"`, `settings: []`, `properties: z.object({}).strict()`.
  - **`index.ts`**: exports `KINDS`, `getKind(id)` (throws `Unknown node kind "<id>"`),
    `findKind(id)` (returns undefined), `registerKind(decl)` and `kindsWithSettings()`.
    `registerKind` validates: unique id, unique setting keys, and each default being one of its
    choices.
- [X] T005 [P] Add to `src/shared/schemas.ts`, per contracts/http-api.md:
  - `NodeOrigin` and `Review = z.enum(["proposed","confirmed","rejected"])`.
  - **`OutputSummary`**: `functionId`, `pipeId`, `inputNodeId`, `displayedText`,
    `provenance: z.enum(["ai_suggested","user_confirmed"])`, `review`, `stale`, `pendingDraft`,
    `versionCount`.
  - **`MapNode`**: add `kind: z.string()`, `origin: NodeOrigin` and
    `output: OutputSummary.nullable()`.
  - **`MapPipe`**: `id`, `treeId`, `inputNodeId`, `outputNodeId`,
    `reads: z.enum(["summary","conversation","anchor"])`, `functionId`, `functionName`,
    `functionVersion: z.number().int()`, `state: Review`, `createdAt`.
  - `ForestResponse.pipes: z.array(MapPipe)`.
  - **`OutputVersion`**: `id`, `text`, `sourceVersion`, `functionVersion`,
    `settings: z.record(z.string(), z.string())`, `provenance: z.literal("ai_suggested")`,
    `confirmed: z.boolean()`, `createdAt`.
  - **`ResolvedSetting`**: `key`, `value`, `source: z.enum(["override","kind","default"])`,
    `kindValue: z.string().nullable()`, `changedAt: z.string().nullable()`.
  - **`FunctionsResponse`**: `{ functions: [{ id, name, version, outputKind, available, reason }] }`.
  - **`RunFunctionResponse`**: `{ output: MapNode, pipe: MapPipe }`.
  - **`OutputViewResponse`**:
    `{ node, pipe, versions: OutputVersion[], input: { node: MapNode, messages: Message[] }, settings: ResolvedSetting[] }`.
  - **`RegenerateOutputResponse`**: `{ output: MapNode, version: OutputVersion }`.
  - `ConfirmOutputRequest = { versionId: z.string().uuid() }` and `OutputResponse = { output: MapNode }`.
  - **`PipeViewResponse`**: `{ pipe, input: MapNode, output: MapNode, versionCount, stale }`.
  - **`KindSettingsResponse`**: `{ kinds: [{ kind, settings: ResolvedSetting[] }] }`.
  - `SaveKindSettingBody = { kind, key, value: z.string().nullable() }`,
    `SaveNodeSettingBody = { key, value: z.string().nullable() }` and
    `NodeSettingsResponse = { settings: ResolvedSetting[] }`.
- [X] T006 [P] Extend the AI boundary in `src/server/ai/provider.ts`: add `CompletionInput`
  (`{ tag: string; system: string; prompt: string; signal?: AbortSignal }`) and
  `complete(input: CompletionInput): Promise<string>` on `AIProvider`, documented as "One short,
  low-effort completion. Throws AIUnavailableError on failure or empty output." Then implement it
  in each provider:
  - **`src/server/ai/claude.ts`**: `beta.messages.create` with `model: MODEL`,
    `max_tokens: 4000`, `betas: [FALLBACK_BETA]`, `fallbacks: "default"`,
    `output_config: { effort: "low" }`, `system`, and `messages: [{ role: "user", content: prompt }]`.
    Map errors through `toProviderError`, and throw `AIUnavailableError` on empty `textOf`.
  - **`src/server/ai/claudeCode.ts`**: `runHeadless(system, prompt, { effort: "low", signal })`,
    trimmed, with empty text throwing `AIUnavailableError`.
  - **`src/server/ai/fake.ts`**:
    - Add `lastComplete` and `completeInputs: CompletionInput[]` to `FakeState`, `getFakeCalls()`
      and `resetFakeCalls()`.
    - Add a per-process counter `completeCount`.
    - `complete()` records the input, calls `behave(input.signal)`, throws `AIUnavailableError`
      in `stall` mode, and returns `` `Fake ${input.tag} #${++fake.completeCount}` ``.
- [X] T007 Record kind and origin at every existing insert site. Nodes gain no parent through
  this, and the Article II guard stays green.
  - **`src/server/forest/trees.ts`**: `kind: "conversation", origin: "root"`.
  - **`src/server/forest/branch.ts`** (`insertBranch`):
    - takes an `origin: "branch" | "parked"` parameter, defaulting to `"branch"`
    - inserts `kind: "conversation"`
  - **`src/server/parked/fire.ts`**: passes `"parked"`.
  - **`src/server/messages/quickBranch.ts`**: `kind: "conversation", origin: "quick_branch"`.

  Depends on T002.
- [X] T008 Update `src/server/mappers.ts`:
  - **`toMapNode`**: gains an optional `output: OutputSummary | null = null` argument, and returns
    `kind`, `origin` and `output`, with `isRoot: n.kind === "conversation" && n.parent_id === null`.
  - **Output nodes**: the `summary` argument is `{ kind: "placeholder", text: "" }`.
  - **New `toMapPipe(row, functionName, state)`**, where `row` is the joined pipe node plus its
    `pipes` row.
  - **New `toOutputVersion(row, confirmedId)`**.

  Depends on T005 and T002.
- [X] T009 Create `src/server/nodes/kinds.ts`:
  - **`assertConversation(node)`**: throws `ConflictError("wrong_kind", "This is a <label>, not a conversation")`
    unless `getKind(node.kind).conversationBacked`.
  - **`validateProperties(kind, props)`**: runs `getKind(kind).properties.parse(props)` and
    converts a ZodError into `InvalidRequestError("Undeclared property …")`.
  - **`isConversationChild(node)`**.

  Also update the two "no parent means root" checks to use kind:
  - **`src/server/forest/positions.ts`**:
    - a pipe gives 409 `wrong_kind`
    - `kind === "conversation" && parent_id === null` stays 409 `root_node`
    - outputs are allowed
  - **`src/server/forest/edgeLabels.ts`**: `root_node` unless `isConversationChild(node)`.

  Depends on T004 and T002.
- [X] T010 [P] Create `src/server/functions/readers.ts` per contracts/declarations.md, with
  `READERS: Record<SourcePart, SourceReader>`.
  - **`summary.read`**: the latest `node_summaries` row (ordered by `created_at DESC, id DESC`),
    giving `{ ok: true, text, version: row.id }`.
    - No row gives `{ ok: false, reason: "This conversation has no summary yet: it needs a completed AI reply." }`.
    - `summary.currentVersions(ids)` uses `DISTINCT ON (node_id) … WHERE node_id IN (…)`.
  - **`conversation.read`**: live, complete messages ordered by `seq`, as the text
    `"Person: …\n\nAssistant: …"`, with version = the last message id.
    - No messages gives `{ ok: false, reason: "This conversation has no messages yet." }`.
    - Its bulk version is the last live complete message per node.
  - **`anchor.read`**: the incoming `branch_markers` row's `anchor_text`, with version = the
    marker id.
    - A root gives `{ ok: false, reason: "A starting conversation has no highlighted passage." }`.
    - Its bulk version comes from `branch_markers.child_node_id`.
- [X] T011 [P] Create the function registry in `src/server/functions/definitions/`, per
  contracts/declarations.md.
  - **`types.ts`**: `FunctionDefinition`.
  - **`analogy.ts`**: `id "analogy"`, `version 1`, `name "Analogy"`,
    `accepts ["conversation"]`, `reads "summary"`, `outputKind "analogy"`,
    `procedure "propose"`.
    - **`instruction.system(settings)`**: the research R8 system text, with:
      - `{reach}` from `close` → "something from a neighbouring field", `everyday` → "something
        from everyday life", `far` → "something from a distant, surprising domain"
      - `{length}` from `one_line` → "one sentence", `short` → "two or three sentences",
        `paragraph` → "one paragraph of at most about 120 words"
    - **`instruction.prompt({ text })`**: `` `<summary>\n${escape(text)}\n</summary>\n\nWrite the analogy.` ``,
      escaping `<` and `>`.
    - **`parse`**: trims, strips wrapping `"“”'`` ` `` quotes, and collapses whitespace. Empty
      text throws `AIUnavailableError("The analogy came back empty")`.
  - **`index.ts`**: `getFunction(id)` (throws `NotFoundError("Unknown function")`),
    `listFunctionsFor(kind)` and `registerFunction(def)`. `registerFunction` validates a unique
    id and that `outputKind` is a registered kind whose `acceptsInputKinds` covers `accepts`.
- [X] T012 Create `src/server/settings/kindSettings.ts`, per research R7 and data-model.md.
  - **`resolveKindSettings(kind, nodeId?)`** returns `ResolvedSetting[]`, in declaration order.
    For each key:
    - the newest row with `node_id = nodeId` whose value isn't null (override)
    - else the newest kind-level row (`node_id IS NULL`) whose value isn't null
    - else the declared default

    Newest means the newest row per scope. A null value in the newest row means "cleared", so
    older values are ignored.
  - **`resolvedValues(kind, nodeId?)`** returns `Record<key, value>`.
  - **`listKindSettings()`** returns the `KindSettingsResponse` for `kindsWithSettings()`.
  - **`setKindSetting(kind, key, value)`** and **`setNodeSetting(nodeId, key, value)`**:
    - validate that the key is declared and the value is null or one of its choices, else
      `InvalidRequestError`
    - `setNodeSetting` loads the node (404 if missing) and uses its kind (FR-033)
    - insert a row only if the resolved value at that scope changes
    - never import anything from `src/server/functions/runner.ts` (FR-032)

  Depends on T002 and T004.
- [X] T013 Create `src/server/functions/state.ts`:
  - **`outputStates(outputIds)`**: one bulk load of versions, events, pipes, and the pipes'
    `READERS[reads].currentVersions(inputIds)` (grouped by `reads`). It returns
    `Map<outputId, OutputState>`, with `OutputState` =
    `{ pipe, versions (newest first), review, confirmedVersionId, displayed, pendingDraft, stale }`.
  - **Rules**, from data-model.md "Derived state":
    - `review` = the newest event's kind, or `"proposed"`
    - `displayed` = `review === "confirmed"` ? the confirmed version : the latest
    - `pendingDraft` = confirmed and latest.id ≠ confirmedVersionId
    - `stale` = latest.source_version ≠ current version (missing current counts as stale)
    - `provenance` = confirmed ? `"user_confirmed"` : `"ai_suggested"`
  - **`toOutputSummary(state)`** maps it to `OutputSummary`.

  Keep the derivation in a pure `deriveOutputState(versions, events, currentVersion)`, which
  T016 unit-tests. Depends on T010 and T002.
- [X] T014 Extend `src/server/forest/forest.ts`: load the project's output and pipe nodes with the
  existing nodes query (it already filters by project), then call
  `outputStates(outputIds)`.
  - Output nodes map through `toMapNode(…, toOutputSummary(state))`.
  - Pipe nodes go to `pipes` through `toMapPipe`, with `functionName` from
    `getFunction(id).name` (falling back to the id if unregistered) and `state` = its output's
    review.
  - Conversation nodes are unchanged.
  - The file must not mention "parked" (Feature 8 guard).

  Depends on T008 and T013.
- [X] T015 Make the home redirect in `src/app/page.tsx` pick the latest node with
  `kind = 'conversation'`.
- [X] T016 [P] Unit tests, which must fail first:
  - **`tests/unit/f9-registries.test.ts`**:
    - The built-in kinds and Analogy register.
    - `registerKind` rejects a duplicate id, and a default outside its choices.
    - `registerFunction` rejects an output kind that doesn't accept the input kind.
    - `validateProperties("analogy", { foo: 1 })` throws (FR-035).
  - **`tests/unit/f9-output-state.test.ts`**, for `deriveOutputState`:
    - no events → proposed, displayed = latest
    - confirm v1, then v2 added → displayed v1, pendingDraft (FR-026, SC-005)
    - confirm v2 → displayed v2
    - reject → rejected
    - confirm after reject → confirmed
    - stale iff the latest source version ≠ current (FR-022)
  - **`tests/unit/f9-analogy-prompt.test.ts`**:
    - The system text contains the phrase for each `reach` and `length` value.
    - The prompt wraps an escaped summary.
    - `parse` strips quotes and whitespace, and throws on empty text.
- [X] T017 [P] Integration test for the migration and backfill in
  `tests/integration/f9-functions.test.ts` (`describe("migration")`), covering QS 1:
  1. Create a root, a Branch child, a `????` quick branch and a fired parked item through the API.
  2. All four are `kind = 'conversation'`.
  3. Their `origin` values are `root`, `branch`, `quick_branch` and `parked`.
  4. `MapNode.origin` matches.
  5. `UPDATE node_summaries …` raises the append-only error.

---

## Phase 3: User Story 1 — Get an analogy for a node (P1) 🎯 MVP

**Goal**: run Analogy on a summarized conversation. An AI-suggested analogy node and a pipe
appear on the map in the same tree, and the source is untouched.

**Independent test**: QS 2–5. Run Analogy on a summarized node: the analogy box and dashed pipe
appear beside it. A node without a summary shows the reason, and a failure creates nothing.

### Tests for User Story 1

- [X] T018 [P] [US1] Integration tests in `tests/integration/f9-functions.test.ts`
  (`describe("US1 run")`):
  - **Availability**: before any AI reply, `GET /functions` lists `analogy` with
    `available: false` and the reason (QS 2, FR-010).
  - **Run** (after a reply and `drainSummaries()`):
    - `POST /functions/analogy/run` gives 201.
    - The output is `kind "analogy"`, `origin "function"`, in the same `treeId`, with
      `parentId null`, `isRoot false`, `output.review "proposed"`,
      `output.provenance "ai_suggested"` and `displayedText "Fake analogy #n"`.
    - The pipe has `inputNodeId` = the source, `reads "summary"`, `functionVersion 1` and
      `state "proposed"` (FR-011, FR-014).
    - The fake's `lastComplete.prompt` contains the summary text.
    - Its `system` contains the default reach and length phrases.
  - **Source untouched** (QS 3, FR-038): the source's messages, latest summary id, `manual`
    position and `NodeView.children` are unchanged.
  - **Forest**: `GET /api/forest` includes the output in `nodes` and the pipe in `pipes`.
  - **Menu per kind**: `GET /functions` on the output node gives `[]` (US1 AS2).
  - **Failure** (US1 AS4, FR-012, QS 5): in `fail` mode the run gives 503 `ai_unavailable`, and
    the counts of nodes, pipes and `function_output_versions` are unchanged.
  - **Wrong kind**: running on the output gives 409 `wrong_kind`.
  - **Twice**: running twice on one node makes two outputs and two pipes (edge case).
  - **Trashed project**: 404 (FR-013).
  - **Unknown function**: 404.
  - **Summary changes during the run** (edge case): in `slow` mode, start a run, then insert a
    new summary row directly before it resolves. The output's version records the old summary
    id, and `output.stale` is true.
- [X] T019 [P] [US1] Unit test `tests/unit/f9-satellites.test.ts` for the satellite placement in
  `src/map/layout/treeLayout.ts`:
  - An output sits right of its input, at `x = input.x + NODE_WIDTH + SATELLITE_GAP`.
  - A second output of the same input stacks below the first.
  - An output whose candidate overlaps a tidy-tree node steps right until clear.
  - A `manual` output keeps its position.
  - Conversation positions are identical with and without outputs.
  - `layoutForest` never moves another tree or a user-placed tree (FR-039).
- [X] T020 [P] [US1] E2E `tests/e2e/f9-node-functions.spec.ts` (`US1`), covering QS 2, 3 and 5:
  1. Start a conversation and open Functions (`node-functions-button`): `function-item-analogy`
     is disabled with `function-unavailable-reason`.
  2. Send a message and wait for the summary. Run Analogy and see `function-open-output`.
  3. Open the map: `mapDebug` shows 2 nodes, one with `kind "analogy"` and
     `review "proposed"`, and `pipes` has 1 entry from the source.
  4. Select the source on the map and use `map-functions-button` to run again: 3 nodes.
  5. With `setAiMode(page, "fail")`, a run shows `function-error`. Switch back to `ok`;
     `function-retry` succeeds.

### Implementation for User Story 1

- [X] T021 [US1] Implement `runFunction(functionId, inputNodeId)` in
  `src/server/functions/runner.ts`, per research R3, with no function-specific code:
  1. `assertId`, then load the node joined with its tree and project. A missing node, or a
     project with `trashed_at`, gives `NotFoundError`.
  2. `def = getFunction(functionId)`. If `def.accepts` doesn't contain `node.kind`, throw
     `ConflictError("wrong_kind", …)`.
  3. `READERS[def.reads].read(node.id)`. If not ok, throw
     `ConflictError("function_unavailable", reason)`.
  4. `settings = resolvedValues(def.outputKind)`.
  5. `text = def.parse(await getAIProvider().complete({ tag: def.id, system: def.instruction.system(settings), prompt: def.instruction.prompt(source, settings) }))`.
     Map `AIUnavailableError` to a 503: add `FunctionUnavailableError` in `src/server/errors.ts`
     with `code "ai_unavailable"`, and map it in `src/server/http/withApi.ts` to
     `errorResponse(503, …)`.
  6. In one transaction:
     - insert the output node: `kind def.outputKind`, `tree_id` = the input's,
       `parent_id null`, `provenance "ai_suggested"`, `origin "function"`,
       `function_id`, `function_version`, and `properties` validated by `validateProperties`
       as `'{}'`
     - insert the pipe node: `kind "pipe"`, the same fields
     - insert the `pipes` row
     - insert the first `function_output_versions` row:
       `{ text, source_version: source.version, function_version, settings: JSON.stringify(settings) }`
  7. Return `{ output, pipe }` through `outputStates` and the mappers.

  Export `listAvailableFunctions(nodeId)`. For each `listFunctionsFor(node.kind)` it returns
  `{ id, name, version, outputKind, available, reason }`, with availability from the reader's
  `read` (no AI call).
- [X] T022 [US1] Add the routes, following `src/app/api/nodes/[nodeId]/parked/route.ts`:
  - `src/app/api/nodes/[nodeId]/functions/route.ts` (GET → `listAvailableFunctions`)
  - `src/app/api/nodes/[nodeId]/functions/[functionId]/run/route.ts` (POST → 201 `runFunction`)
- [X] T023 [P] [US1] Add `listFunctions(nodeId)` and `runFunction(nodeId, functionId)` to
  `src/lib/api.ts`, parsed with `FunctionsResponse` and `RunFunctionResponse`. Update the
  `getForest` parse to the new `ForestResponse`.
- [X] T024 [US1] Create `src/components/kinds/FunctionMenu.tsx` per contracts/ui.md
  (`FunctionMenu`):
  - **Props**: `{ nodeId, onDone(output: MapNode), onClose, showOpenLink: boolean }`.
  - **Loading**: loads `api.listFunctions` when opened.
  - **Items**: `function-item-<id>` buttons. Disabled items show `function-unavailable-reason`.
  - **Running**: shows "Working…" and blocks a second run.
  - **Success**: calls `onDone`. With `showOpenLink`, it shows "<Name> ready" and a
    `function-open-output` link to `/n/{id}`.
  - **Failure**: shows `function-error` with the server message and a `function-retry` button
    that repeats the call.
  - Escape closes it.
- [X] T025 [US1] Add a `node-functions-button` ("Functions") to
  `src/components/chat/NodeHeader.tsx` that toggles `FunctionMenu` with `showOpenLink`. Thread
  `nodeId` through from `src/components/chat/ChatView.tsx`. Leave the suggestions toggle
  unchanged.
- [X] T026 [US1] Update `src/map/forestGraph.ts`:
  - `NodeAttrs` gains `kind`, `output: OutputSummary | null` and `inputId: string | null`.
  - Output nodes are added to the graph with no edges. Pipes are never graph edges, so
    `forEachEdge` stays parent-child only.
  - **`diffForest`**:
    - A new output or pipe marks its tree changed.
    - A change to `output.displayedText`, `review`, `stale` or `pendingDraft` is reported in
      `changedSummaries`, with the node's new MapNode, so labels redraw.
    - A pipe state change sets a new `pipesChanged` flag.
- [X] T027 [US1] Implement satellite placement in `src/map/layout/treeLayout.ts` (research R11):
  - After the tidy layout of conversation nodes, collect the graph nodes with `treeId` = this
    tree and `kind !== "conversation"`, sorted by `createdAt` then id.
  - For each, place it at its `manual` position, or else as follows:
    1. Start at the input's position:
       `x = input.x + NODE_WIDTH + SATELLITE_GAP (export const SATELLITE_GAP = 40)`,
       `y = input.y + stackOffset`. `stackOffset` is the sum of `height + 16` of earlier outputs
       of the same input.
    2. While its box overlaps any box already placed in this tree, add
       `NODE_WIDTH + SATELLITE_GAP` to x.
  - Include outputs in the tree `box`. Skip an output whose input isn't positioned.
  - Make T019 pass.
- [X] T028 [US1] Draw outputs and pipes in `src/map/MapRenderer.ts` (research R10,
  contracts/ui.md).
  - **Sprites**: build them only for `forest.nodes`. Pipes aren't sprites.
  - **`applyLabel`** for a node with `output`:
    - the tag reads `` `AI · ${getKind(kind).label}` ``
    - the label is `output.displayedText`
    - the fill is `palette.aiFill`, a new palette entry: a pale tint of `ai` in light mode and a
      dark tint in dark mode
  - **`drawBox`**: a dashed outline in `palette.ai` while `review === "proposed"`, solid when
    confirmed. Dashes are drawn by stroking short segments along the rounded rect.
  - **`drawPipes()`**, called after `drawEdges`: for each visible pipe, a horizontal cubic from
    the input's right-middle to the output's left-middle, in `palette.ai`.
    - dashed at alpha 0.6 while `state === "proposed"`, solid at width 2.5 when confirmed
    - an arrowhead triangle at the output end
    - a dashed stroke samples the curve with `curvePoint` and strokes alternating segments
  - **Drag**: `startDrag` moves only the output, because `isRoot` is false. `moveDrag` redraws
    pipes too.
  - **Selection**: add an `onNodeSelect(cb: (id: string | null, rect: DOMRect-like) => void)`
    hook, fired from the single-click path in `endDrag` and on background clicks (`null`).
  - **Debug**: extend `publishDebug` with `nodes[].kind`, `review`, `stale` and `pendingDraft`,
    plus `pipes: [{ id, from, to, state }]`.
- [X] T029 [US1] In `src/components/map/MapHost.tsx`:
  - Track the selected node from `onNodeSelect`. When it is a conversation node, render a
    `map-functions-button` positioned at the node's screen rect that opens `FunctionMenu`.
  - `onDone` calls `refreshRef.current()` at once and then selects the new output.
  - Update the `MapDebug` type in `tests/e2e/helpers.ts`.
- [X] T030 [US1] Add styles in `src/app/globals.css`: `.function-menu`, items, the disabled
  reason, working and error states, and `.map-functions-button`, in light and dark. Then run
  T018–T020 until they pass.

**Checkpoint**: Analogy runs from chat and from the map, and the output and pipe appear beside
the source. QS 1–5 pass.

---

## Phase 4: User Story 2 — See the analogy beside its input (P1)

**Goal**: opening a node opens its kind's view. An analogy opens beside its input, and a pipe
shows its details. Conversation-only actions are refused on other kinds.

**Independent test**: QS 6–8 and 18.

### Tests for User Story 2

- [X] T031 [P] [US2] Integration tests in `tests/integration/f9-functions.test.ts`
  (`describe("US2 views")`):
  - **Output view**: `GET /api/nodes/{outputId}/output` gives `versions` (1, not confirmed),
    `pipe`, `input.node.id` = the source, `input.messages` = the source's live messages, and
    `settings` of 2 resolved defaults.
  - **Pipe view**: `GET /api/nodes/{pipeId}/pipe` gives the pipe, input, output,
    `versionCount 1` and `stale false`.
  - **Wrong kind, reads**: `GET /api/nodes/{outputId}` gives 409 `wrong_kind` with
    `kind: "analogy"`. `GET /output` on a conversation gives 409 `wrong_kind`.
  - **Wrong kind, conversation actions** (QS 18, FR-005): `POST /messages`, `/branches`,
    `/parked`, `/summary/refresh` and `POST /api/definitions` with the output's `nodeId` all
    give 409 `wrong_kind`.
  - **Position and edge label**: `PUT /position` on the output gives 200 and changes only
    `manual`, and the pipe row is unchanged. `PUT /position` on the pipe gives 409 `wrong_kind`.
    `PUT /edge-label` on the output gives 409 `root_node`.
- [X] T032 [P] [US2] E2E in `tests/e2e/f9-node-functions.spec.ts` (`US2`), covering QS 6–8:
  1. Double-click the analogy on the map (via `__farabiMapScreenPoint`): the URL is
     `/n/{outputId}`.
  2. `output-panel` shows `output-text`, and `input-panel` shows `input-conversation` with the
     source messages and `open-input`.
  3. Selecting text in `input-conversation` shows no highlight toolbar.
  4. Double-click the source: chat opens, and the Branches tab doesn't list the analogy.
  5. Click the pipe (`__farabiMapPipePoint`): `pipe-card` shows "Analogy" and "v1", "reads the
     summary" and "Proposed", and the URL is still `/map`.
  6. Click a parent-child edge: the edge-label editor still opens.

### Implementation for User Story 2

- [X] T033 [US2] Add `assertConversation` guards (T009) at the start of these services:
  - `sendMessage` in `src/server/messages/send.ts`
  - `createBranch` in `src/server/forest/branch.ts`
  - `parkTangent` in `src/server/parked/park.ts`
  - the capture service in `src/server/definitions/capture.ts`
  - `src/app/api/nodes/[nodeId]/summary/refresh/route.ts`
  - `getNodeView` in `src/server/forest/nodeView.ts`

  `getNodeView` throws `ConflictError("wrong_kind", …)`. Extend `ConflictError` with an optional
  `extra` object that `withApi` spreads into the body, so the body includes `{ kind }`.
- [X] T034 [US2] Create `src/server/functions/views.ts`:
  - **`getOutputView(outputId)`**:
    - Load the node, with 409 `wrong_kind` unless a `pipes` row has `output_node_id` = it.
    - Load the state from `outputStates` and the versions via `toOutputVersion`.
    - The input comes from `toMapNode` with its summary, plus `liveMessages(inputId)` mapped
      through `toMessage`.
    - Settings come from `resolveKindSettings(node.kind, node.id)`.
  - **`getPipeView(pipeId)`**: 409 `wrong_kind` unless the node's kind is `pipe`.

  Add the routes `src/app/api/nodes/[nodeId]/output/route.ts` (GET) and
  `src/app/api/nodes/[nodeId]/pipe/route.ts` (GET), and `getOutputView` and `getPipeView` in
  `src/lib/api.ts`.
- [X] T035 [US2] Add a `readOnly` prop to `src/components/chat/Message.tsx`. When it is true, no
  selection toolbar, branch markers or term capture handlers are attached; the text still renders
  as markdown.
- [X] T036 [US2] Create the view registry and dispatch.
  - **`src/components/kinds/views.tsx`**: exports
    `VIEWS: Record<ViewId, ComponentType<{ nodeId: string }>>` with `chat → ChatView`,
    `output_beside_input → OutputView` and `pipe → PipeView`.
  - **`src/app/n/[nodeId]/page.tsx`**: becomes a server component.
    1. `assertId`-style UUID check. A bad id or missing row calls `notFound()`.
    2. Read `nodes.kind` with `db`.
    3. Render `const View = VIEWS[getKind(kind).view]` as `<View key={nodeId} nodeId={nodeId} />`.
- [X] T037 [US2] Create `src/components/kinds/OutputView.tsx` (view `output_beside_input`) per
  contracts/ui.md. This story covers the read-only parts; US3–US5 add controls.
  - **Loading**: `api.getOutputView`, polling every 4 s while visible (like ChatView), and
    calling `setLastNode(nodeId)`.
  - **`output-panel`**: the "AI · Analogy" heading, `output-text` and the `output-state` chip.
  - **`input-panel`**: the input's `SummaryLabel`, `input-conversation` rendering
    `<Message readOnly>` for each message, and an `open-input` link.
  - Layout is a two-column grid, stacked below 800px.
- [X] T038 [US2] Create `src/components/kinds/PipeCard.tsx`, which shows:
  - `pipe-function`: "<functionName> v<functionVersion>"
  - `pipe-reads`: "reads the summary", "reads the conversation" or "reads the highlighted
    passage"
  - `pipe-state`: "Proposed", "Confirmed" or "Rejected"
  - `pipe-versions`: "N version(s)" plus " · stale" when stale
  - "Open input" and "Open analogy" links

  Also create `src/components/kinds/PipeView.tsx`, which loads `api.getPipeView` and renders
  `PipeCard` full-page.
- [X] T039 [US2] Make pipes clickable in `src/map/MapRenderer.ts` and
  `src/components/map/MapHost.tsx`.
  - **Renderer**:
    - Add `onPipeClick(cb: (pipeId, screen) => void)`.
    - In `handleBackgroundClick`, test pipes first with `pipeAt(world)`: the distance to the
      sampled curve within `EDGE_HIT_PX`. Then fall back to `edgeAt`.
    - Add the test hook `window.__farabiMapPipePoint(pipeId)`, mirroring
      `__farabiMapEdgePoint`, and remove it in `destroy()`.
  - **`onNodeOpen`**: unchanged. It pushes `/n/{id}`, which the page dispatches by kind.
  - **MapHost**: shows `PipeCard` (data from `forestRef` plus an `api.getPipeView` fetch for the
    version count) in a popover at the click point. Escape or a click outside closes it.
- [X] T040 [US2] Add styles in `src/app/globals.css`: `.output-view` two-column grid,
  `.output-panel`, `.input-panel`, `.pipe-card`, and `.pipe-view`. Run T031 and T032 until they
  pass.

**Checkpoint**: kinds are visible. Each kind opens its own view, pipes are selectable, and QS
6–8 and 18 pass.

---

## Phase 5: User Story 3 — Confirm or reject a proposed analogy (P2)

**Goal**: the user vouches for or rejects an output. A rejected output is hidden but kept.

**Independent test**: QS 9–11.

### Tests for User Story 3

- [X] T041 [P] [US3] Integration tests in `tests/integration/f9-functions.test.ts`
  (`describe("US3 review")`):
  - **Confirm**: `POST /output/confirm { versionId }` gives `review "confirmed"` and
    `provenance "user_confirmed"`. The forest pipe's `state` is `"confirmed"`. One event row
    exists with `provenance 'user_confirmed'`.
  - **Confirm conflicts**: confirming again gives 409 `already_confirmed`. Confirming a non-latest
    version gives 409 `not_latest`.
  - **Reject**: rejecting another output gives `review "rejected"`, with the node, pipe and
    version rows still present and one `rejected` event (`user_authored`). Rejecting again gives
    409 `already_rejected`.
  - **Restore**: confirming the rejected output's latest version brings it back to
    `"confirmed"`.
  - **Untouched output** (US3 AS3): it stays `proposed` and `ai_suggested`.
  - **Raw SQL**: `UPDATE function_output_events` and `DELETE FROM function_output_versions`
    raise the append-only error.
- [X] T042 [P] [US3] E2E in `tests/e2e/f9-node-functions.spec.ts` (`US3`), covering QS 9 and 10:
  1. In OutputView, `confirm-output` makes `output-state` read "Confirmed". On the map, `mapDebug`
     shows `review "confirmed"` and a pipe `state "confirmed"`.
  2. On a second analogy, `reject-output` removes it and its pipe from `mapDebug`.
  3. `map-show-rejected` brings them back. Toggling it off hides them again.

### Implementation for User Story 3

- [X] T043 [US3] Implement `confirmOutput(outputId, versionId)` and `rejectOutput(outputId)` in
  `src/server/functions/review.ts`, per the data-model.md state table.
  - Load the state with `outputStates([id])`. A node that isn't an output gives 409 `wrong_kind`.
  - **Confirm**:
    - `versionId` must equal the latest version's id, else 409 `not_latest`; a version that
      isn't on this output gives 404
    - if review is `confirmed` and `confirmedVersionId === versionId`, 409 `already_confirmed`
    - otherwise insert `{ kind: 'confirmed', version_id, provenance: 'user_confirmed' }`
  - **Reject**:
    - if already rejected, 409 `already_rejected`
    - otherwise insert `{ kind: 'rejected', provenance: 'user_authored' }`
  - Both return `{ output: MapNode }`.

  Add `src/app/api/nodes/[nodeId]/output/confirm/route.ts` (body `ConfirmOutputRequest`) and
  `…/output/reject/route.ts` (POST), and `confirmOutput` and `rejectOutput` in `src/lib/api.ts`.
- [X] T044 [US3] Add `confirm-output` and `reject-output` buttons to
  `src/components/kinds/OutputView.tsx`, shown per contracts/ui.md. After an action, reload the
  view.
- [X] T045 [US3] Map support for review states:
  - **`src/state/settingsStore.ts`**: add a persisted `showRejected: boolean` (default `false`)
    and `setShowRejected`, and include it in `partialize`.
  - **`src/components/map/MapHost.tsx`**:
    - render the `map-show-rejected` toggle button in the map's lower-left corner
    - pass the flag into `renderer.setShowRejected(flag)`
    - the confirmed/proposed styling from T028 already follows `review`
  - **`src/map/MapRenderer.ts`**: filter rejected outputs and their pipes out of sprites, layout
    input and pipes unless `showRejected`. When shown, draw them at alpha 0.4. Toggling calls
    `render` with that tree marked changed.
- [X] T046 [US3] Add styles for the state chip, the review buttons and the toggle in
  `src/app/globals.css`. Run T041 and T042 until they pass.

**Checkpoint**: outputs can be confirmed and rejected, rejected ones hide but are kept, and QS
9–11 pass.

---

## Phase 6: User Story 4 — Know when an output is stale and refresh it on purpose (P2)

**Goal**: a stale badge appears when the source's summary moves on, with no AI call. Regenerate
adds a version and never replaces a confirmed text on its own.

**Independent test**: QS 12–14.

### Tests for User Story 4

- [X] T047 [P] [US4] Integration tests in `tests/integration/f9-functions.test.ts`
  (`describe("US4 staleness")`):
  - **Fresh** (QS 14): after a run, `output.stale` is false.
  - **Drift** (QS 12, FR-022, FR-024, SC-004): send another message in the source, then
    `drainSummaries()`.
    - The forest shows `stale: true`.
    - `getFakeCalls().completeInputs.length` is unchanged, and there is still 1 version.
    - Loading the forest again 3 times makes no further `complete` calls.
  - **Regenerate a proposed output** (FR-025):
    - `POST /output/regenerate` gives 201 with a version 2 whose `sourceVersion` is the new
      summary id.
    - `stale` is false, and `displayedText` is the new text.
    - Both versions are listed newest first, with their times.
  - **Regenerate a confirmed output** (QS 13, FR-026, SC-005):
    - After drift and regenerate, `displayedText` is still the confirmed text, `pendingDraft` is
      true, `review` is `"confirmed"` and `stale` is false.
    - Confirming the new version makes it displayed and clears `pendingDraft`.
  - **Failure**: in `fail` mode, regenerate gives 503 and the version count is unchanged.
  - **Rejected output**: staleness is still computed, but the output isn't on the default map
    (edge case, covered by the T045 filter).
- [X] T048 [P] [US4] E2E in `tests/e2e/f9-node-functions.spec.ts` (`US4`), covering QS 12 and 13:
  1. Confirm an analogy, then send another message in the source and wait for its summary.
  2. On the map, `mapDebug` shows `stale: true` for the analogy.
  3. Click the pill at `__farabiMapBadgePoint(id)`. `stale` becomes false and `pendingDraft`
     true.
  4. In OutputView, `draft-panel` shows the new text and `output-text` the confirmed one.
  5. `confirm-draft` swaps them. `versions-list` has 2 entries.

### Implementation for User Story 4

- [X] T049 [US4] Implement `regenerateOutput(outputNodeId)` in `src/server/functions/runner.ts`,
  reusing the same private steps as `runFunction` (read, resolve, complete, parse).
  - Load the output's `pipes` row. A missing row gives 409 `wrong_kind`.
  - `def = getFunction(pipe.function_id)`, with the input from `pipe.input_node_id` (same
    project check).
  - The source comes from `READERS[pipe.reads]`. Unavailable gives 409 `function_unavailable`.
  - Settings are `resolvedValues(node.kind, node.id)`, which includes this node's override.
  - Only on success, insert one `function_output_versions` row with `def.version`.
  - Nothing else changes: no event is written.
  - Return `{ output, version }`.

  Add `src/app/api/nodes/[nodeId]/output/regenerate/route.ts` (POST → 201) and
  `regenerateOutput` in `src/lib/api.ts`.
- [X] T050 [US4] Map stale pill, in `src/map/MapRenderer.ts` and
  `src/components/map/MapHost.tsx`.
  - **Renderer**: for outputs with `output.stale`, draw a pill in the box's top-right corner as a
    child container. It reads "Stale · ↻ Regenerate", with `eventMode "static"`.
    - `pointertap` calls `onRegenerate(id)` and stops propagation, so it doesn't select or drag.
    - `setRegenerating(id, state)` switches the text to "Regenerating…" or "Failed · Retry".
    - Draw a "New draft" dot when `pendingDraft`.
    - Add `window.__farabiMapBadgePoint(nodeId)`, and remove it in `destroy()`.
  - **MapHost**: `onRegenerate` calls `api.regenerateOutput`, then refreshes. On failure it
    sets the failed state, and the next click retries.
- [X] T051 [US4] In `src/components/kinds/OutputView.tsx`:
  - When stale, show `stale-badge` ("Made from an older summary") with `regenerate-button`.
    While working, show "Regenerating…". On error, show the message and Retry.
  - When `pendingDraft`, show `draft-panel` with the latest version's text and `confirm-draft`
    ("Use this version"), which calls `confirmOutput(latestId)`.
  - Add a collapsible `versions-list`, newest first. Each entry shows its time, settings (for
    example "Everyday life · Two or three sentences") and a "Confirmed" marker.
- [X] T052 [US4] Add styles for the badge, the draft panel and the versions list in
  `src/app/globals.css`. Run T047 and T048 until they pass.

**Checkpoint**: staleness shows without AI calls, Regenerate is manual and history-keeping, and
QS 12–14 pass.

---

## Phase 7: User Story 5 — Settings scoped to a kind, with per-node overrides (P3)

**Goal**: the Analogy section on the Settings page is generated from its declaration. A per-node
override lives in the analogy's view. Saving never runs anything.

**Independent test**: QS 15, 16 and 19 (the kind half).

### Tests for User Story 5

- [X] T053 [P] [US5] Unit test `tests/unit/f9-settings.test.ts` for the resolution in
  `src/server/settings/kindSettings.ts`, against the test DB. Put it under
  `tests/integration/f9-settings.test.ts` if the unit project has no DB.
  - With nothing set, the default applies (`source "default"`).
  - A kind-level value gives `source "kind"`.
  - An override gives `source "override"`, and other nodes still show `kind`.
  - Clearing the override (null) falls back to kind.
  - Clearing the kind value falls back to default.
  - After an override, a changed kind-level value doesn't affect the overriding node.
  - Unknown kind, unknown key, a value outside the choices, and an override of an `analogy` key
    on a conversation node are all rejected (FR-033).
  - Saving an unchanged value writes no row.
- [X] T054 [P] [US5] Integration tests in `tests/integration/f9-functions.test.ts`
  (`describe("US5 settings")`):
  - **Kind-level** (QS 15, SC-008):
    - `PUT /api/kind-settings { kind: "analogy", key: "length", value: "one_line" }` leaves
      `completeInputs.length` unchanged.
    - The next run records `settings.length = "one_line"`, and its system prompt contains "one
      sentence".
  - **Override** (QS 16): `PUT /api/nodes/{outputA}/settings { key: "length", value: "paragraph" }`.
    Regenerating A and B records `paragraph` for A and `one_line` for B.
  - **History**: every change is a `kind_setting_changes` row with its time.
  - **Endpoint shape**: `GET /api/kind-settings` lists only `analogy`.
- [X] T055 [P] [US5] Unit test `tests/unit/f9-kind-settings-ui.test.ts` with jsdom (SC-007):
  - Render `KindSettingsSections` with a stubbed response.
  - `registerKind` a test kind with one choice setting before rendering; its
    `kind-settings-<id>` section and select appear.
  - A kind with `settings: []` renders no section.
- [X] T056 [P] [US5] E2E in `tests/e2e/f9-node-functions.spec.ts` (`US5`):
  1. On `/settings`, `kind-settings-analogy` has `kind-setting-analogy-length`. Setting "One
     sentence" shows "Saved".
  2. In an analogy's `node-settings`, set `node-setting-length` to "A paragraph": the override
     note appears.
  3. Choose "Use default (One sentence)": the note disappears.

### Implementation for User Story 5

- [X] T057 [US5] Add the routes and client methods:
  - `src/app/api/kind-settings/route.ts`: GET → `listKindSettings`; PUT with body
    `SaveKindSettingBody` → `setKindSetting`, then `listKindSettings`.
  - `src/app/api/nodes/[nodeId]/settings/route.ts`: PUT with `SaveNodeSettingBody` →
    `setNodeSetting`, then `{ settings: resolveKindSettings(kind, nodeId) }`.
  - In `src/lib/api.ts`: `getKindSettings`, `saveKindSetting` and `saveNodeSetting`.
- [X] T058 [US5] Create `src/components/settings/KindSettingsSections.tsx`:
  - It loads `api.getKindSettings` and renders a "Node kinds" heading.
  - It renders one `kind-settings-<kind>` section per returned kind, titled with
    `getKind(kind).label`.
  - Each declared setting is a `kind-setting-<kind>-<key>` select, with its label and help, and
    the default's option label suffixed " (default)".
  - It saves with the same "Saved" and error pattern as `SettingsForm`.

  Render it at the end of `src/components/settings/SettingsForm.tsx`. Leave Feature 6's sections
  unchanged.
- [X] T059 [US5] Create `src/components/kinds/NodeSettings.tsx` and render it in `OutputView`:
  - One `node-setting-<key>` select per resolved setting, with the first option
    "Use default (<kind value label or default label>)" mapping to `null`.
  - When `source === "override"`, show `node-setting-override-note-<key>` ("Overriding the
    setting for all analogies").
  - Saving calls `api.saveNodeSetting` and never regenerates.
- [X] T060 [US5] Add styles in `src/app/globals.css`. Run T053–T056 until they pass.

**Checkpoint**: kind settings and overrides work, and nothing runs on save. QS 15–16 pass.

---

## Phase 8: Polish & Cross-Cutting

- [X] T061 [P] SC-006 extensibility test in `tests/integration/f9-functions.test.ts`
  (`describe("extensibility")`), covering QS 19:
  - `registerFunction` a test-only definition: `id "echo-anchor"`, `reads "anchor"`,
    `accepts ["conversation"]`, `outputKind "analogy"`, a trivial instruction and `parse`.
  - On a branch node it runs through `POST /functions/echo-anchor/run`, and the fake prompt
    contains the anchor text.
  - On a root it is unavailable, with the anchor reason.
  - The test file imports nothing from `runner.ts` internals: only the registry and HTTP.
- [X] T062 Extend `tests/integration/constitution.test.ts` with a Feature 9 case:
  - **Articles I and II**: after a run, a regenerate, a confirm and a reject:
    - every `function_output_versions.provenance` is `ai_suggested`
    - output and pipe node provenance is `ai_suggested`
    - events are `user_confirmed` or `user_authored` only
  - **Append-only**: no file in `src` matches
    `/(updateTable|deleteFrom)\("(pipes|function_output_versions|function_output_events|kind_setting_changes|node_summaries)"\)/`.
  - **`.complete(` callers**: only files under `src/server/ai/` or `src/server/functions/`
    contain `.complete(`.
  - **Insert sites**: only `src/server/functions/runner.ts` inserts nodes with a
    non-`"conversation"` kind. Check `insertInto("nodes")` files: each is either one of the known
    conversation sites or `runner.ts`.
  - **FR-032**: no file under `src/server/settings/` imports from `../functions`.
  - **Article VI**: the existing `setting_changes` rule still passes. `kind_setting_changes` is
    mentioned only under `src/server/settings/` and `src/server/db/`.
  - **Article II**: the existing parent_id guard still passes, and the DB CHECK rejects
    inserting an analogy with a parent.
- [X] T063 [P] Performance check for SC-009:
  1. Extend `scripts/seed-large.ts` with an optional `--outputs N` flag. It inserts N analogy
     outputs with pipes and versions directly, using fake text and a summary source version.
  2. Run it with 500 nodes and 50 outputs.
  3. Extend `tests/e2e/scale.spec.ts`: the map opens and a double-click opens a node view within
     1 s.
- [X] T064 [P] Check the output view at 1400px, 1000px and 600px widths, in light and dark
  mode. Check the map pill and pipe legibility at the zoom levels where labels show. Fix issues
  in `src/app/globals.css` and in the `src/map/MapRenderer.ts` palette.
- [X] T065 Run `npm run typecheck`, `npm run lint`, `npm test` and `npm run test:e2e`. SC-001
  requires every Feature 1–8 test to pass unchanged, apart from the TRUNCATE and `MapDebug` type
  updates. Fix any failures, then walk through every row of quickstart.md, including one manual
  run with `AI_PROVIDER=claude-code` to read a real analogy.

---

## Dependencies & Execution Order

- **Setup (T001–T003)** → **Foundational (T004–T017)** → user stories.
- **US1 (Phase 3)** is the MVP.
- **US2 (Phase 4)** needs outputs to exist (T021), and can start once T021–T022 land. Its
  guards (T033) are independent of US1.
- **US3 (Phase 5)** and **US4 (Phase 6)** need US2's `OutputView` (T037). US3 and US4 don't
  depend on each other, but they share `OutputView.tsx` and `MapRenderer.ts`: serialize those
  edits.
- **US5 (Phase 7)** needs T012 and `OutputView` (T037) for the override UI. The Settings page
  half (T057–T058) only needs Foundational.
- **Polish** runs after all the stories.

Within Foundational:

- T004, T005, T006, T010, T011 and T015 are independent `[P]`.
- T007 needs T002.
- T008 needs T002 and T005.
- T009 needs T004.
- T012 needs T004.
- T013 needs T010.
- T014 needs T008 and T013.
- T016 needs T004, T011 and T013.
- T017 needs T007 and T008.

Within each story, the tests come first; then services, then routes, then the client API, then
UI.

### Shared-file notes

- **`src/map/MapRenderer.ts`**: T028, T039, T045 and T050.
- **`src/components/map/MapHost.tsx`**: T029, T039, T045 and T050.
- **`src/components/kinds/OutputView.tsx`**: T037, T044, T051 and T059.
- **`src/lib/api.ts`**: T023, T034, T043, T049 and T057.
- **`src/server/functions/runner.ts`**: T021 and T049.
- **`tests/integration/f9-functions.test.ts`** gains a `describe` block per story.
- **`src/app/globals.css`**: every story.
- Serialize edits to the same file; `[P]` applies only across different files.

## Parallel examples

```text
Foundational:  T004 ∥ T005 ∥ T006 ∥ T010 ∥ T011 ∥ T015, then T007, T008, T009, T012 → T013 → T014; T016 ∥ T017
US1:           T018 ∥ T019 ∥ T020 ∥ T023, then T021 → T022 → T024 → T025; T026 → T027 → T028 → T029 → T030
US2:           T031 ∥ T032, T033 ∥ T034 ∥ T035, then T036 → T037 → T038 → T039 → T040
US3 ∥ US4:     T041 ∥ T042 ∥ T047 ∥ T048, then T043 → T044 → T045; T049 → T050 → T051 (serialize OutputView/MapRenderer)
US5:           T053 ∥ T054 ∥ T055 ∥ T056, then T057 → T058 ∥ T059 → T060
Polish:        T061 ∥ T063 ∥ T064, then T062 → T065
```

## Implementation Strategy

1. **MVP** (Setup, Foundational, US1): Analogy runs from chat and the map, and outputs and pipes
   appear beside their source. Stop and validate QS 1–5.
2. **US2**: kinds get their own views and pipes are selectable. This completes the P1 value.
   Validate QS 6–8 and 18.
3. **US3 and US4**: review, then staleness and manual Regenerate. They are independent, but
   serialize the shared files. Validate QS 9–14.
4. **US5**: kind settings and per-node overrides. Validate QS 15–16.
5. **Polish**: the extensibility proof (SC-006), constitution guards, scale, visual checks, the
   full regression and the quickstart walk-through.
