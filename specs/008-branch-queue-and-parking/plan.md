# Implementation Plan: Branch Queue (Parked Tangents & Branches Panel)

**Branch**: `008-branch-queue-and-parking` | **Date**: 2026-09-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-branch-queue-and-parking/spec.md`

## Summary

**Toolbar.** The highlight toolbar gains **Park** next to Define and Branch. Both Branch and Park
now open a small inline form with an optional "Your question" input.

- **Branch** creates the branch as today. It then seeds the new node's composer draft with the
  typed question, or with the anchor text when the question is blank.
- **Park** stores a user-authored parked tangent on the open node. It creates no node.

**Panel.** A right-hand panel in chat view has two tabs:

- **Branches**: the node's direct children.
- **Parked**: its live parked tangents.

Both come from two new fields on `NodeView`, so they follow the open node through the existing
loads and polling.

**Firing.** A parked item becomes a branch in one transaction: node, `selection` marker, and, if
it has a question, the user message and pending reply. The reply then streams as for any send.
Without a question, the response carries the anchor text as a draft to preload.

**Storage.** Parked tangents are an immutable anchor row plus an append-only event log:
`question_set`, `discarded` and `fired`. Edit and discard therefore need no UPDATE, DELETE or
PATCH, and abandoned tangents stay on record (Article VI). A unique terminal-event index
guarantees one branch per item.

## Technical Context

**Language/Version**: TypeScript 6, Node (unchanged)

**Primary Dependencies**: Next 16 App Router, React 19, zustand 5, Kysely and pg, zod 4. No new
dependencies.

**Storage**: PostgreSQL. Migration `0007_parked_tangents.ts` adds `parked_tangents` and
`parked_tangent_events`, both append-only and enforced by a trigger
([data-model.md](./data-model.md)).

**Testing**: Vitest and Playwright on the fake provider:

- `tests/integration/f8-parked.test.ts`
- `tests/e2e/f8-branch-queue.spec.ts`
- extended guards in `tests/integration/constitution.test.ts`
- updates to the Branch-click helpers in `tests/e2e/helpers.ts`, `us2-branch.spec.ts` and
  `f5-suggestions.spec.ts`

**Target Platform**: local web app on 127.0.0.1.

**Project Type**: a single Next.js web application.

**Performance Goals**:

- Firing a parked item that has a question meets Feature 2's SC-004 bound: at most 2 seconds
  plus the reply's usual time to first words. The work is one transaction, the same work as
  `????`.
- Node load adds two indexed queries.

**Constraints**:

- No DELETE or PATCH routes (guard test).
- Parked rows are insert-only, and so are their events.
- Parked content never reaches the AI until it is fired.
- Map view is unchanged.
- The Branch and `????` request contracts are unchanged (FR-016).

**Scale/Scope**: single user. Tens of parked items per node at most. No pagination.

## Constitution Check

*Gate: checked before Phase 0 and re-checked after Phase 1.* Constitution version 1.0.1.

| Article | Result |
|---------|--------|
| I. User is final authority | PASS. Parked tangents and their events are `user_authored`, enforced by CHECKs. Branches created by firing are `user_authored` as today. The AI never proposes parking or questions (spec: out of scope). A guard test keeps AI modules out of `parked_*`. |
| II. Additive growth | PASS. Parking creates no structure. Firing only adds a node, a marker and messages. Discarding a draft is an explicit user action that appends an event. Nothing is physically deleted, and no node is ever removed. There is no merge: repeated parks of the same span and a direct Branch stay independent. Regeneration is blocked while a reply has live parked items (R6), so an item is never invalidated as a side effect (FR-017). No DELETE or PATCH routes. |
| III. Nothing invented ahead of evidence | N/A. No AI-proposed structure. |
| IV. User-led exploration | PASS. The feature exists to make the user's own tangents cheaper. The Branches tab lists only structure the user has created, and the AI starts nothing. |
| V. Compression preserves meaning | N/A. Branches-tab entries use existing summaries unchanged. |
| VI. History is data | PASS. Park, edit, discard and fire are all kept with their times. Discarded tangents, the "abandoned" signal the article names, are kept rather than erased. Nothing derives personalization from them. |

**Post-design re-check**: PASS.

- The spec's "discard" is a scoped exception to no-deletion. The design honors it more strictly
  than the spec requires: the item is hidden, not deleted.
- Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/008-branch-queue-and-parking/
├── plan.md              # This file
├── research.md          # R1–R10
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── http-api.md      # park, question, discard, fire; NodeView.children/parked; has_parked
│   └── ui.md            # two-step toolbar, BranchPanel tabs, test ids
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/server/db/migrations/0007_parked_tangents.ts        NEW tables, indexes, append-only trigger
src/server/db/schema.ts                                 ParkedTangentsTable, ParkedTangentEventsTable
src/shared/schemas.ts                                   ParkedTangent, Park/Question bodies, FireResponse;
                                                        NodeView.children, NodeView.parked
src/server/forest/branch.ts                             extract validateAnchor + insertBranch (createBranch reuses)
src/server/messages/send.ts                             extract insertUserTurn (sendOrdinary reuses)
src/server/parked/state.ts                              NEW live items, current question, lock helper
src/server/parked/park.ts                               NEW park, setQuestion, discard
src/server/parked/fire.ts                               NEW one-transaction fire, then generate()
src/server/forest/nodeView.ts                           children + parked; canRegenerate honors parked
src/server/messages/regenerate.ts                       409 has_parked
src/server/mappers.ts                                   toParkedTangent
src/app/api/nodes/[nodeId]/parked/route.ts              NEW POST
src/app/api/parked/[id]/question/route.ts               NEW POST
src/app/api/parked/[id]/discard/route.ts                NEW POST
src/app/api/parked/[id]/fire/route.ts                   NEW POST (?wait=1 for tests)
src/lib/api.ts                                          park, setParkedQuestion, discardParked, fireParked
src/components/chat/BranchAction.tsx                    Park button; inline question form; draft seeding
src/components/chat/BranchPanel.tsx                     NEW tabs, lists, empty states, edit/discard/fire
src/components/chat/ChatView.tsx                        render BranchPanel beside the chat; onParked reload
src/state/settingsStore.ts                              persisted branchPanelOpen
src/app/globals.css                                     .branch-panel, tabs, toolbar form
tests/integration/f8-parked.test.ts                     NEW
tests/integration/constitution.test.ts                  parked guards
tests/e2e/f8-branch-queue.spec.ts                       NEW
tests/e2e/helpers.ts, us2-branch.spec.ts, f5-suggestions.spec.ts   confirm step after Branch
```

**Structure Decision**: this follows the existing layout.

- **Server**: parked-tangent logic lives in a new `src/server/parked/` module, like `settings/`
  and `feedback/`. Branch and message insertion are refactored into transaction-scoped helpers,
  so fired branches are built exactly like normal ones.
- **UI**: new UI stays in `src/components/chat/`, because the panel belongs to chat view only.

## Complexity Tracking

None.
