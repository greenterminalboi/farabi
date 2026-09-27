# Implementation Plan: Map Interactions, Definitions, and Streaming

**Branch**: `002-map-definitions-streaming` | **Date**: 2026-09-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-map-definitions-streaming/spec.md`

## Summary

Replies stream into the chat over Server-Sent Events while generation runs in the background on
the server, so it survives navigation and can be stopped. `????` becomes a server-side quick
branch that resends the user's last message in a new branch. The PixiJS map gains node and tree
dragging (root drags the tree) and editable edge labels. A Definitions tab collects AI-drafted,
two-part definitions that the user confirms or edits, and every collected term is underlined in
all conversations with a hover card. Everything extends Feature 1's stack and data; one forward-only
migration adds the new columns and tables.

## Technical Context

**Language/Version**: TypeScript 5.x (6.0 installed) on Node.js 22+ (24 installed)

**Primary Dependencies**: Unchanged from Feature 1: Next.js 16, React 19, PixiJS 8 +
pixi-viewport, graphology, d3-hierarchy, Zustand, Zod, Kysely, `@anthropic-ai/sdk`, Claude Code
CLI. No new runtime dependencies (SSE via `EventSource`; research R1)

**Storage**: Postgres 17 + pgvector (Docker); migration `0002_workspace.ts`

**Testing**: Vitest (unit, integration against Postgres), Playwright (production build, GPU
Chromium), fake AI provider with streaming and `stall` modes

**Target Platform**: Current desktop browsers against the local server

**Project Type**: Local web application (unchanged)

**Performance Goals**: first reply text no later than Feature 1's full reply (SC-002); drag with
no visible lag at 500 nodes (SC-006); Definitions tab < 1 s and hover card < 300 ms with 500 terms
(SC-009, SC-009a)

**Constraints**: sent text never changes (text written once when a reply ends); no deletes; drags
never touch parent links; `????` never reaches the AI; subscription use stays per-user and local

**Scale/Scope**: one user; 500+ nodes, 500+ definitions; one new page (Definitions)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Article | Gate | Pre-design | Post-design |
|---------|------|------------|-------------|
| I. User is final authority | AI output carries state; user overrides are recorded | PASS — FR-028, FR-032, FR-038 | PASS — definition drafts `ai_suggested`, confirm/edit `user_confirmed`; labels `user_authored`; hand positions override the layout (data-model) |
| II. Additive growth | No merge, reconciliation or deletion | PASS — FR-018, FR-037 | PASS — no DELETE endpoints; clearing a label is a new NULL version; no endpoint writes `parent_id`; quick branch only adds a node + marker |
| III. Nothing invented ahead of evidence | AI output grounded or clearly labelled | PASS — FR-029 as clarified | PASS — the usage part is grounded in the source message and the node's own messages; the general part is labelled general; no edge-label suggestions (research R8) |
| IV. User-led exploration | No AI-initiated structure | PASS — `????` is user-initiated; FR-026 | PASS — the provider still cannot create nodes, markers, labels or definitions (ai-provider contract) |
| V. Compression preserves meaning | Traceable back to source | PASS — FR-033, FR-005 | PASS — definitions link to their source message; summaries use only complete replies |
| VI. History is data | Changes kept, not overwritten | PASS — FR-025, FR-035 | PASS — label and definition versions are append-only; replaced replies kept; stopped/incomplete text kept |

No violations; Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/002-map-definitions-streaming/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── http-api.md      # Changed and new endpoints, SSE events
│   └── ai-provider.md   # Streaming reply, define()
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

New and changed files within Feature 1's layout:

```text
src/
├── app/
│   ├── definitions/page.tsx                 # NEW Definitions tab
│   └── api/
│       ├── messages/[messageId]/stream/     # NEW SSE
│       ├── messages/[messageId]/stop/       # NEW
│       ├── nodes/[nodeId]/position/         # NEW
│       ├── nodes/[nodeId]/edge-label/       # NEW
│       └── definitions/…                    # NEW capture, list, get, confirm, versions, redraft
├── components/
│   ├── chat/                                # streaming Message, Stop, "Send to definitions",
│   │                                        # term marks + hover card, quick-branch navigation
│   └── definitions/                         # NEW list, card, editor, filter
├── map/
│   ├── MapRenderer.ts                       # drag, edge hit-test, label drawing
│   └── layout/                              # hand-placed overrides, user-placed trees
├── lib/terms.ts                             # NEW term index → matcher
└── server/
    ├── db/migrations/0002_workspace.ts      # NEW
    ├── messages/generation.ts               # NEW background generation registry
    ├── messages/quickBranch.ts              # NEW
    ├── forest/positions.ts, edgeLabels.ts   # NEW
    ├── definitions/                         # NEW capture, draft queue, versions
    └── ai/                                  # streaming + define() in all three providers

tests/unit, tests/integration, tests/e2e    # one file per story, as in Feature 1
```

**Structure Decision**: Same single Next.js project. Domain logic stays in `src/server/`, free of
Next.js; the map stays imperative in `src/map/`.

## Open Points for the User

- **R1**: SSE without the Vercel AI SDK library (reasoning in research R1).
- **R6**: Dragging the root node moves the whole tree (alternative: Shift-drag).

## Complexity Tracking

No constitution violations; nothing to justify.
