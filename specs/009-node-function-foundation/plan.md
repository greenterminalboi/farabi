# Implementation Plan: Node Function Foundation

**Branch**: `009-node-function-foundation` | **Date**: 2026-09-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/009-node-function-foundation/spec.md`

## Summary

**Kinds.** Every node gains a `kind`, an `origin` and a declared `properties` object.

- Existing nodes become `conversation`, with their origin backfilled from their history.
- Kinds are client-safe declarations in `src/shared/kinds/`: conversation, analogy and pipe.
  Each declares its view, map label rule, settings and accepted inputs.
- Non-conversation nodes never have a parent, so outputs and pipes can never become branches.

**Functions.** Function definitions are server-side data in `src/server/functions/definitions/`.
One generic runner executes any of them:

1. Read the declared part of the input node through a reader.
2. Resolve the output kind's settings.
3. Call a new generic `provider.complete`.
4. Only on success, insert the output node, a pipe node, the `pipes` row and the first version,
   in one transaction.

Analogy is the only definition shipped.

**Versions and review.** Output text is an append-only version log, and review is an append-only
event log (`confirmed` or `rejected`).

- A confirmed text stays displayed until the user confirms a newer draft.
- An output is stale when its latest version's source summary id differs from the input's latest
  `node_summaries.id`. That is computed in SQL, with no AI call.
- Regeneration happens only when the user presses Regenerate.

**Settings.** Kind settings are an append-only table with kind-level and per-node rows. They
resolve as override, then kind value, then declared default. The Settings page renders one
section per declaring kind.

**UI.**

- The map draws outputs as AI-tinted boxes placed beside their input, and pipes as directed
  horizontal curves: dashed while proposed, solid once confirmed.
- Double-click opens the view the kind declares. For an analogy, that is the analogy beside its
  input conversation.

## Technical Context

**Language/Version**: TypeScript 6, Node (unchanged)

**Primary Dependencies**: Next 16 App Router, React 19, zustand 5, Kysely and pg, zod 4, PixiJS 8
with pixi-viewport, graphology, d3-hierarchy. No new dependencies.

**Storage**: PostgreSQL. Migration `0009_node_functions.ts`:

- adds `kind`, `origin`, `function_id`, `function_version` and `properties` to `nodes`, with a
  backfill
- adds four append-only tables: `pipes`, `function_output_versions`, `function_output_events`
  and `kind_setting_changes`
- adds an append-only trigger on `node_summaries`

See [data-model.md](./data-model.md).

**Testing**: Vitest and Playwright on the fake provider:

- `tests/unit/f9-settings.test.ts`, `f9-output-state.test.ts`, `f9-satellites.test.ts`,
  `f9-registries.test.ts`, `f9-analogy-prompt.test.ts`
- `tests/integration/f9-functions.test.ts`
- extended guards in `tests/integration/constitution.test.ts`
- `tests/e2e/f9-node-functions.spec.ts`
- TRUNCATE lists in `tests/integration/setup.ts` and `tests/e2e/helpers.ts`

**Target Platform**: local web app on 127.0.0.1.

**Project Type**: a single Next.js web application.

**Performance Goals**:

- **SC-002**: an output appears within 10 s of Run. That is one low-effort completion, then one
  transaction and an immediate map refresh.
- **SC-009**: the map opens and a node view opens within 1 s with 500+ nodes plus outputs.
  - Forest load adds three set-based queries: pipes, the latest version and event per output,
    and current source versions.
  - Satellite placement is local to one tree.

**Constraints**:

- No DELETE or PATCH routes.
- Every new table is append-only.
- No function runs without an explicit user request (FR-024).
- Settings saves never reach the runner.
- The conversation flow (chat, branches, parked, definitions, summaries) is unchanged for
  conversation nodes.
- Feature 6 settings stay global.

**Scale/Scope**: single user. Tens to hundreds of outputs per project, and a handful of versions
per output. No pagination.

## Constitution Check

*Gate: checked before Phase 0 and re-checked after Phase 1.* Constitution version 1.0.1.

| Article | Result |
|---------|--------|
| I. User is final authority | PASS. Output nodes, pipe nodes and every output version are inserted `ai_suggested`, enforced by CHECKs on versions. Only a user `confirmed` event (`user_confirmed`) makes an output confirmed, and a confirmed text is never replaced without another confirmation (FR-026, R5). The map styles proposed outputs and pipes as tentative (dashed, AI-tinted), unlike confirmed and user material. Nothing downstream builds on outputs: running a function on an output is out of scope, and the analogy kind accepts no function. |
| II. Additive growth | PASS. A run only adds a node, a pipe and a version. Regeneration adds a version and never overwrites. Rejection hides and never deletes. There is no merge: repeated runs make independent outputs (edge case). Outputs aren't children and never change a parent-child relationship (DB CHECK). Pipes are immutable, and no DELETE or PATCH routes exist. |
| III. Nothing invented ahead of evidence | PASS, with care. The only input is the user's own summary. The instruction forbids adding claims about the idea (R8). The comparison domain is AI-supplied by nature, and it is labelled and styled as AI material throughout. No connection or coupling between the user's nodes is proposed: a pipe records provenance of a user-requested derivation, not an AI-inferred relationship. |
| IV. User-led exploration | PASS. Functions run only on an explicit user action. Nothing is surfaced unprompted, and staleness only shows a badge; it never regenerates (FR-024, SC-003). The menu never blocks starting a conversation or branch. |
| V. Compression preserves meaning | PASS. Each output keeps its pipe to the exact source summary version it came from (traceable), and the view shows it beside the full input conversation. Analogy isn't a compression of the node; it is presented as an aid, not a replacement label. |
| VI. History is data | PASS. Every version, confirm and reject event, and kind-setting change is kept with its time. Kind settings are explicit output-form instructions (1.0.1 carve-out). A guard keeps `kind_setting_changes` readable only by the settings module, and no personalization reads it. |

**Post-design re-check**: PASS. Complexity Tracking is empty.

- **Article I note**: `nodes.provenance` stays the creation provenance. The effective review is
  derived from events and exposed as `output.provenance` and `review` in every API shape, so no
  client can treat a proposed output as confirmed.

## Project Structure

### Documentation (this feature)

```text
specs/009-node-function-foundation/
├── plan.md              # This file
├── research.md          # R1–R14
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── http-api.md      # forest.pipes, MapNode.kind/output, functions, output, pipe, kind settings
│   ├── declarations.md  # kind and function declarations, readers, runner, provider.complete
│   └── ui.md            # output boxes, pipes, FunctionMenu, OutputView, PipeView, settings, test ids
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/server/db/migrations/0009_node_functions.ts          NEW columns + backfill, 4 tables, triggers
src/server/db/schema.ts                                  NodesTable fields; Pipes, OutputVersions, OutputEvents, KindSettingChanges
src/shared/kinds/{index,conversation,analogy,pipe}.ts    NEW kind declarations + registry
src/shared/schemas.ts                                    MapNode.kind/origin/output, MapPipe, ForestResponse.pipes,
                                                         OutputVersion, OutputViewResponse, FunctionsResponse,
                                                         ResolvedSetting, kind-settings bodies
src/server/ai/provider.ts                                CompletionInput, AIProvider.complete
src/server/ai/{claude,claudeCode,fake}.ts                complete() per provider
src/server/functions/definitions/{index,analogy}.ts      NEW function registry + Analogy definition
src/server/functions/readers.ts                          NEW summary / conversation / anchor readers
src/server/functions/state.ts                            NEW review, displayed, pendingDraft, stale derivation
src/server/functions/runner.ts                           NEW runFunction, regenerateOutput
src/server/functions/review.ts                           NEW confirm, reject
src/server/functions/views.ts                            NEW output view, pipe view, functions availability, forest extras
src/server/settings/kindSettings.ts                      NEW resolve, list, set kind-level and override
src/server/nodes/kinds.ts                                NEW assertConversation (409 wrong_kind), validateProperties
src/server/mappers.ts                                    toMapNode kind/origin/output; toMapPipe; isRoot by kind
src/server/forest/forest.ts                              outputs + pipes; staleness via readers
src/server/forest/{trees,branch,positions,edgeLabels,nodeView}.ts   origin on insert; kind guards; isRoot by kind
src/server/messages/{send,quickBranch}.ts, parked/{park,fire}.ts,
  definitions/capture.ts, app/api/nodes/[nodeId]/summary/refresh   wrong_kind guards; origin on insert
src/app/page.tsx                                         latest conversation node only
src/app/n/[nodeId]/page.tsx                              read kind server-side, render its view
src/app/api/nodes/[nodeId]/functions/route.ts            NEW GET
src/app/api/nodes/[nodeId]/functions/[functionId]/run/route.ts  NEW POST
src/app/api/nodes/[nodeId]/output/route.ts               NEW GET
src/app/api/nodes/[nodeId]/output/{regenerate,confirm,reject}/route.ts  NEW POST
src/app/api/nodes/[nodeId]/pipe/route.ts                 NEW GET
src/app/api/nodes/[nodeId]/settings/route.ts             NEW PUT
src/app/api/kind-settings/route.ts                       NEW GET, PUT
src/lib/api.ts                                           client methods for the above
src/components/kinds/views.tsx                           NEW view id → component registry
src/components/kinds/OutputView.tsx                      NEW analogy beside input
src/components/kinds/PipeView.tsx, PipeCard.tsx          NEW
src/components/kinds/FunctionMenu.tsx                    NEW shared by map and chat
src/components/kinds/NodeSettings.tsx                    NEW per-node override controls
src/components/chat/Message.tsx                          readOnly prop (no toolbar/markers)
src/components/chat/NodeHeader.tsx                       Functions button
src/components/settings/KindSettingsSections.tsx         NEW generated sections; SettingsForm renders it
src/map/forestGraph.ts                                   kind/output attrs; diff covers outputs and pipes
src/map/layout/treeLayout.ts                             satellite placement for outputs
src/map/MapRenderer.ts                                   output styling, stale pill, pipes, pipe hit-test,
                                                         onNodeSelect/onPipeClick/onRegenerate, debug hooks
src/components/map/MapHost.tsx                           functions button, PipeCard, show-rejected toggle, regenerate
src/state/settingsStore.ts                               persisted showRejected
src/app/globals.css                                      output view, menu, pipe card, map overlay
tests/unit/f9-*.test.ts                                  NEW
tests/integration/f9-functions.test.ts                   NEW
tests/integration/constitution.test.ts                   Feature 9 guards
tests/integration/setup.ts, tests/e2e/helpers.ts         TRUNCATE lists; MapDebug type
tests/e2e/f9-node-functions.spec.ts                      NEW
```

**Structure Decision**: the existing layout is extended.

- **Server**:
  - Function machinery gets its own module, `src/server/functions/`, like `parked/` and
    `definitions/`.
  - Kind settings join `src/server/settings/`, as the Feature 6 guard requires.
  - Kind guards used across conversation endpoints live in `src/server/nodes/kinds.ts`.
- **Shared**: kind declarations sit in `src/shared/kinds/` because the client dispatches views,
  styles the map and builds settings sections from them.
- **UI**: new components are grouped under `src/components/kinds/` because they belong to kinds,
  not to chat or map. Chat and map only gain entry points.

## Complexity Tracking

None.
