# Implementation Plan: Farabi v0.2 — Message Graph and Canvas

**Branch**: `v0.2` (feature directory `010-v02-message-graph-canvas`) | **Date**: 2026-10-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/010-v02-message-graph-canvas/spec.md`

## Summary

**Graph.** Conversations stop being the unit.

- One new `nodes` table holds every element, and each element has one `parent_id`:
  - a user message is a `question` edge, whose parent is the answer it was asked from, or another
    edge
  - an AI reply is an `answer` node, whose parent is its edge; retries and regenerations are
    sibling answers
  - a function application is a `function` edge, and its outputs are its children
- A tree starts with an origin edge that has no parent.
- The AI's context is the ancestor path, found with one recursive query.
- A database trigger makes sent text, answers, structure and provenance immutable, and forbids
  deletes.

**Migration.** Migration 0010 runs in one transaction:

1. Back up with `pg_dump`.
2. Move the old tables, unchanged, into a frozen `v1` schema.
3. Record checksums.
4. Convert everything with a deterministic, id-reusing, idempotent converter, with a ledger.

`v1:verify` proves text, context, counts and untouched originals. Conversation-level hand placements
are kept as data but not applied (research R4, flagged for the owner).

**Canvas.** One canvas per project replaces the chat and map views.

- PixiJS draws frames, connectors, regions, the path emphasis and the minimap.
- A DOM text layer above the canvas shares the camera through one CSS transform. It mounts real,
  selectable text only for elements in view, each clipped to a share of a global character
  budget, plus pinned elements (selection, composer, stream).
- Text is rendered imperatively from cached `RichText` (markdown blocks and runs with source
  offsets), so the existing selection-to-offset mapping, markers, terms and suggestions keep
  working.
- Layout is a first-child-aligned tidy tree: conversations read as columns and branches fan right.
- The camera is a two-state machine (follow or free) that only a send or walk can move.
- Composer, toolbar, panel and menus are screen-space overlays.

**Functions.** Feature 009's kind and function registries carry over:

- Kinds gain `shape` and `display`.
- Analogy reads an answer's text.
- Run creates a function edge and output in one transaction after the AI call.
- Run again adds a sibling output under the same edge.
- Reviews are append-only.
- Kind settings resolve as the edge override, then the kind value, then the default.

**Off.** Summaries are switched off and kept in `v1`.

**Order of work.** Scale proof first (M0), then data and migration, server, canvas, text layer,
carried-over features, then functions.

## Technical Context

**Language/Version**: TypeScript 6 on Node 24 (unchanged).

**Primary Dependencies**: Next 16 App Router, React 19, zustand 5, Kysely and pg, zod 4, PixiJS 8
with pixi-viewport, graphology.

- `unified` and `remark-parse` go from transitive (through react-markdown) to direct
  dependencies, for `RichText` parsing.
- `d3-hierarchy` is no longer used by the canvas layout, which moves to an in-house tidy tree.
- No new packages.

**Storage**: PostgreSQL 17 (Docker). Migration `0010_message_graph.ts`:

- moves 12 tables into a frozen `v1` schema
- creates `trees`, `nodes`, `edge_notes`, `output_reviews`, `kind_setting_changes`,
  `parked_tangents`, `parked_tangent_events`, `project_cameras`, `v1_conversion` and
  `v1_checksums`
- changes `definitions` and `feedback_items` additively

See [data-model.md](./data-model.md) and [contracts/migration.md](./contracts/migration.md).

**Testing**: Vitest (unit and integration, fake provider) and Playwright (production build, GPU
Chromium).

- New: `f10-*` unit, integration and e2e suites, and `v1-convert.test.ts`.
- `constitution.test.ts` is rewritten for the new guards.
- Carried-over suites are adapted (SC-016).
- Chat- and map-only suites are retired along with the code they test.

**Target Platform**: local web app on 127.0.0.1, desktop Chromium-class browser. Mobile and touch
are out of scope.

**Project Type**: a single Next.js web application.

**Performance Goals**:

- **SC-005**: pan and zoom hold 60 fps, with p95 frame time ≤ 16.7 ms while panning, at 5,000
  elements, and the canvas opens within 1 s.
- **SC-008**: a target is in view within 1 s of a send or walk.
- **SC-010**: first words of a reply are no slower than in Feature 2. The same streaming path is
  used, keyed by answer.
- **SC-012**: the minimap responds within 100 ms.

**Constraints**:

- Text is selectable at every zoom (non-negotiable).
- No DELETE or PATCH routes.
- Every history table is append-only, and `nodes` is guarded by trigger.
- The original data is byte-identical after migration.
- No AI call without an explicit user action, apart from replies and Feature 2's definition drafts.
- The camera never moves on its own.

**Scale/Scope**: single user.

- Today: 6 trees and 67 messages.
- Target: 5,000 elements per project. Tens of thousands is a later goal.
- Average reply about 1.7k characters, longest about 8k.

## Constitution Check

*Gate: checked before Phase 0 and re-checked after Phase 1.* Constitution version 1.0.1.

| Article | Result |
|---------|--------|
| I. User is final authority | **PASS.** Answers, function edges and outputs are inserted `ai_suggested`. Question edges, notes, placements, parked tangents and settings are `user_authored`. Only a `confirmed` review (`user_confirmed`) changes an output's status, and it is recorded as an event, never by rewriting the row. Proposed outputs and function edges are drawn tentative and AI-tinted, and answers keep the AI tag (FR-060). Outputs are leaves: no composer, no Branch, no functions. So no later derivation builds on unconfirmed AI output, and rejected outputs are hidden and excluded from everything. Answers can anchor branches and functions as before. They are the user-led conversation itself, still labelled as AI. |
| II. Additive growth | **PASS.** Retry, regenerate and run again add siblings. Nothing replaces or reconciles: attempts are independent nodes, never versions of one answer, and are drawn side by side. `nodes_guard` forbids deletes and every structural update, so drags can't re-parent. The migration moves the originals rather than altering them, and they stay readable. Parked-tangent discard stays an explicit user choice, recorded as an event (Feature 8). |
| III. Nothing invented ahead of evidence | **PASS.** No feature proposes connections, couplings, notation or prompts. Analogy keeps Feature 9's rule that every claim about the idea must come from its input, now the answer's own text. It is AI material by nature and is always presented as such. Suggested underlines come only from the reply's own bold text (Feature 5). |
| IV. User-led exploration | **PASS.** The AI never creates edges. Branch, ask, `????`, parked fire and function runs all start from a user action. The camera moves only on the user's send or walk (R11, SC-008). Nothing AI-initiated is surfaced. |
| V. Compression preserves meaning | **PASS.** Summaries, the only compression, are off (FR-062). Clipped text is the element's own text cut at a boundary with a visible fade, never rewritten, and zooming in reveals the full text. Zoomed-out views stay traceable to full fidelity by construction. |
| VI. History is data | **PASS.** Every attempt, send time, review, note version, setting change and parked event is kept with its time, and the conversion ledger records how each v1 row became v2. Camera and placement are presentation and mutable, as in Feature 2. No personalization reads any of it. |

**Post-design re-check**: PASS, and Complexity Tracking is empty. Two items were checked against
the articles and found compliant:

1. Not applying v1 conversation-level placements (R4) loses no data. The values are kept in the
   ledger and the original rows, so it is not a deletion. The owner may still prefer the
   "placed run" alternative.
2. Allowing Analogy on unconfirmed answers matches Feature 9's precedent, where a function ran on
   AI summaries. The output is marked and never built on.

## Project Structure

### Documentation (this feature)

```text
specs/010-v02-message-graph-canvas/
├── plan.md              # This file
├── research.md          # R1–R18
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── http-api.md      # canvas, ask, branches, attempts, notes, panel, parked, definitions, functions, feedback
│   ├── migration.md     # conversion rules, invariants, fixture coverage
│   ├── canvas-ui.md     # layers, mounting, input map, camera, composer, minimap, test hooks
│   └── declarations.md  # kinds with shape/display, function definitions, runner, Analogy v2
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
# Data and migration
src/server/db/migrations/0010_message_graph.ts   NEW v1 schema move + freeze, checksums, v2 tables/triggers, additive changes, convert, backfills
src/server/db/schema.ts                          REWRITE v2 Database types (nodes, trees, edge_notes, output_reviews, …)
src/server/db/v1/schema.ts                       NEW V1Database types (converter only)
src/server/db/v1/convert.ts                      NEW convertV1 (frozen once shipped)
src/server/db/v1/verify.ts                       NEW invariants for v1:verify and tests
scripts/migrate.ts                               backup step before 0010 (pg_dump via docker compose)
scripts/v1-convert.ts, scripts/v1-verify.ts      NEW npm scripts
scripts/seed-large.ts                            REWRITE --elements N on the v2 model
db/backups/                                      NEW, git-ignored

# Server
src/server/graph/elements.ts                     NEW insert helpers (shape from kind), toElement mapping, edge state, live-project load
src/server/graph/canvas.ts                       NEW GET canvas (elements, trees, notes, reviews, camera; orphan finalize)
src/server/graph/ask.ts                          NEW startTree, ask (incl. ???? via quickBranch), sendUnsent
src/server/graph/quickBranch.ts                  from messages/quickBranch.ts, re-expressed on edges (requery_of)
src/server/graph/branch.ts                       from forest/branch.ts: validateSpan (any element with final text), insertBranchEdge
src/server/graph/attempts.ts                     NEW retry/regenerate as sibling answers (replaces messages/retry, regenerate)
src/server/graph/context.ts                      NEW buildReplyInput via ancestor CTE (replaces replyInput + inheritedContext)
src/server/graph/positions.ts, notes.ts, panel.ts, camera.ts   NEW
src/server/answers/generation.ts                 from messages/generation.ts, keyed by answer id; no summary hook
src/server/parked/{park,fire,state}.ts           re-targeted to v2 elements
src/server/definitions/{capture,list}.ts         source_id; excerpt from element
src/server/feedback/{create,exportFile}.ts       project_id, element_id, view canvas
src/server/functions/{runner,review}.ts          edges + outputs, rerun, output_reviews; versions/state/readers trimmed
src/server/functions/definitions/analogy.ts      v2: accepts answer, reads text
src/server/settings/kindSettings.ts              overrides on function edges
src/shared/kinds/{types,index,question,answer,function,analogy}.ts   shape + display; conversation/pipe removed
src/shared/schemas.ts                            Element, Tree, Camera, EdgeState, Span, responses; chat/map shapes removed
src/app/api/canvas/route.ts                      NEW
src/app/api/trees/route.ts, trees/[id]/origin    POST start tree; origin unchanged
src/app/api/nodes/[nodeId]/{ask,branches,panel,parked,position,functions,functions/[functionId]/run,confirm,reject}/route.ts
src/app/api/edges/[edgeId]/{send,attempts,note,rerun,settings}/route.ts   NEW
src/app/api/answers/[answerId]/{stop,stream}/route.ts                     NEW (from messages/*)
src/app/api/projects/[id]/camera/route.ts        NEW
src/app/api/{definitions,feedback,kind-settings,parked,projects,settings}/…   adapted

# Client
src/app/page.tsx                                 renders <CanvasHost projectId focus span/>
src/app/n/[nodeId]/page.tsx, src/app/map/page.tsx   redirects (R18)
src/app/dev/canvas-spike/page.tsx                NEW M0 spike (test hooks only; removed after M0)
src/canvas/CanvasHost.tsx                        NEW owns renderer, text layer, camera, overlays, data store
src/canvas/store.ts                              NEW zustand: elements by id, trees, focus, drafts (persisted), showRejected, minimap
src/canvas/graph.ts                              NEW graphology build + incremental merge
src/canvas/layout/treeLayout.ts                  REWRITE first-child-aligned tidy tree, variable sizes
src/canvas/layout/forestLayout.ts                from map/layout (tree placement rules unchanged)
src/canvas/layout/heights.ts                     NEW measureText estimator + measured-height cache
src/canvas/renderer/CanvasRenderer.ts            from map/MapRenderer.ts: frames, connectors, regions, path, focus, drag; no text
src/canvas/renderer/minimap.ts                   NEW
src/canvas/camera.ts                             NEW follow/free state machine, glide, limits, persistence
src/canvas/input.ts                              NEW wheel/pinch/drag/keyboard mapping (R11)
src/canvas/text/TextLayer.ts                     NEW mount/unmount, transform sync, pinning, test hooks
src/canvas/text/budget.ts                        NEW proportional character budget
src/canvas/text/richText.ts                      NEW markdown → blocks/runs with offsets (cached)
src/canvas/text/render.ts                        NEW runs → DOM with markers/terms/suggestions (uses chat/markerRanges)
src/canvas/overlays/{Composer,SelectionToolbar,SidePanel,MarkerMenu,NoteEditor,FunctionMenu,OutputActions,EmptyState}.tsx
                                                 from chat/Composer, BranchAction, BranchPanel, map/EdgeLabelEditor, kinds/*
src/components/chat/{selection,markerRanges}.ts  kept; selection root attribute data-node-id
src/components/definitions/*, feedback/*, settings/*, common/{ProjectMenu,SettingsLink}   adapted
src/lib/{api,replyStream,feedbackContext}.ts     new endpoints; stream by answer id; context from canvas store
src/app/globals.css                              canvas, text layer, overlays; chat/map styles removed

# Removed (code only; their data lives on in v1)
src/components/chat/{ChatView,NodeHeader,InheritedContext,Message,rehypeSourceOffsets,TermText}.tsx
src/components/map/*, src/map/*, src/components/kinds/{OutputView,PipeView,PipeCard,views,NodeSettings}.tsx
src/components/common/{ViewToggle,NewConversationButton}.tsx
src/server/forest/*, src/server/summaries/*, src/server/messages/*, src/server/nodes/kinds.ts,
src/server/functions/{state,readers,views}.ts, src/lib/nodeCache.ts
api routes listed under "Removed" in contracts/http-api.md

# Tests
tests/unit/f10-{layout,budget,camera,richtext,selection,registries,heights}.test.ts      NEW
tests/integration/{v1-convert,f10-graph,f10-functions,f10-settings}.test.ts              NEW
tests/integration/constitution.test.ts                                                   REWRITE guards
tests/integration/{f2-us4-definitions,f3-*,f4-projects,f6-settings,f8-parked}.test.ts   adapted (SC-016)
tests/e2e/f10-{m0-spike,us1-ask,us2-zoom-select,us3-branch,us4-migration,us5-camera,us6-arrange,us7-attempts,us8-functions,us9-carried,scale}.spec.ts  NEW
tests/e2e/{f3-*,f4-projects,f6-settings}.spec.ts                                         adapted
tests/integration/setup.ts, tests/e2e/helpers.ts                                         TRUNCATE lists (v2 + v1 fixtures), canvas helpers
retired: chat- and map-only unit/integration/e2e suites (us1–us5, f2-us1/2/3/5, f5, f7, f8 e2e, f9-*, layout, stack, f2-layout-manual)
```

**Structure Decision**: The single Next.js app is kept, and the chat/map split is replaced by
three new homes:

- `src/server/graph/` for everything about elements: asking, branching, attempts, context,
  canvas load, placement and notes.
- `src/canvas/` for the client canvas: the renderer, text layer, camera, layout and overlays. It
  replaces `src/map/` and the chat components, since the two views no longer exist.
- `src/server/db/v1/` for the only code that may read the frozen originals.

Feature modules that survive (`parked/`, `definitions/`, `feedback/`, `functions/`, `settings/`,
`projects/`) stay where they are and are re-targeted.

### Delivery milestones (input to /speckit-tasks)

| Milestone | Delivers | Exit check |
|-----------|----------|------------|
| **M0 Scale proof** | Spike route with 5,000 synthetic elements through the real text layer design (R7–R9, R17) | quickstart §0 numbers met and recorded. If not, apply the R17 fallbacks before M3. |
| **M1 Data and migration** | 0010, converter, verify, backup step, v1 fixture test | `v1-convert.test.ts` green. `v1:verify` OK on a restored copy of real data. |
| **M2 Server graph** | Elements, canvas load, ask, branch, `????`, unsent send, attempts, context, notes, positions, camera, parked, definitions and feedback re-targeted, generation by answer | `f10-graph`, adapted f2/f3/f4/f6/f8 integration and constitution suites green |
| **M3 Canvas core** (P1 stories 1 and 3) | CanvasHost, renderer, layout, camera, composer, side panel, routing and redirects | e2e us1, us3 and us5 |
| **M4 Text layer** (P1 story 2) | `RichText`, budget, pinning, selection toolbar, markers, terms, suggestions | e2e us2, us9; drift ≤ 1 px; `offscreenMounted` = 0 |
| **M5 Arrange, attempts, minimap** (P2 stories 5, 6 and 7) | Drag element and tree, notes, retry and regenerate siblings, minimap | e2e us5–us7, scale spec |
| **M6 Functions** (P3 story 8) | Kinds with shape, runner on edges, Analogy v2, reviews, settings | `f10-functions`, e2e us8, SC-013 |
| **M7 Cleanup** | Remove dead chat/map/summary code and suites; README; run migration on the owner's data | Full suite green. Owner runs quickstart §1 on their database. |

## Complexity Tracking

None. No constitution violations need justification.
