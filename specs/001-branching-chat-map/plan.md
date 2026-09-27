# Implementation Plan: Branching Chat with Map View

**Branch**: `001-branching-chat-map` | **Date**: 2026-09-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-branching-chat-map/spec.md`

## Summary

Users start root conversations, highlight any text in a message to branch a new, independent
conversation from it, and switch to a map that shows every tree with AI-generated one-sentence
labels. The app is a Next.js + React + TypeScript application run locally and used in the
browser, storing an adjacency-list forest in a local Postgres (with pgvector enabled but
unused). The map is a PixiJS canvas driven imperatively from a
graphology model, laid out per tree. The AI layer sits behind a small interface with a fake
implementation; the real Claude integration, streaming transport and summary trigger are
deferred at the user's request.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 22 LTS

**Primary Dependencies**: Next.js (App Router), React, PixiJS v8 + pixi-viewport,
graphology, d3-hierarchy (tidy-tree layout), Zustand, Zod, Kysely. AI SDK: deferred (R10)

**Storage**: Postgres 17 with the pgvector extension enabled, run locally via Docker Compose
(R2, R3)

**Testing**: Vitest (unit, and integration against a local test database), Playwright
(end-to-end) (R11)

**Target Platform**: Current desktop browsers (Chrome, Firefox, Safari) against a local server

**Project Type**: Local web application (Next.js frontend + route-handler backend)

**Performance Goals**: Map open and node-to-chat navigation < 1 s at 500 nodes / 20 trees
(SC-006); chat input keystroke latency < 100 ms during summary work (SC-004); summaries on the
map within 10 s of a reply (SC-003, subject to R10)

**Constraints**: Single user, single device, no sign-in; server bound to localhost and rejects
cross-origin requests; no delete/merge paths; messages immutable; other trees never move on growth

**Scale/Scope**: One user; design target 500+ nodes, 20+ trees; ~3 screens (chat, map, empty
state)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Article | Gate | Pre-design | Post-design |
|---------|------|------------|-------------|
| I. User is final authority | Every AI-produced object carries explicit provenance; AI content never treated as confirmed | PASS — spec FR-014–016 | PASS — `provenance` column on messages, summaries, nodes, markers; summaries always `ai_suggested`, rendered distinctly (data-model, R5, R8) |
| II. Additive growth | No merge, reconciliation or automatic deletion | PASS — FR-009 | PASS — no DELETE/PATCH endpoints; FKs `ON DELETE RESTRICT`; regenerate blocked when a marker exists so no branch is orphaned (http-api, data-model) |
| III. Nothing invented ahead of evidence | AI proposes no structure from general knowledge | PASS — feature has no AI-proposed structure | PASS — AI boundary exposes only `reply` and `summarize`; pgvector unused (R3 notes future constraint) |
| IV. User-led exploration | No AI-initiated suggestions; branches wait for the user | PASS — FR-004, out of scope list | PASS — provider cannot create nodes; branch opens awaiting user input (ai-provider) |
| V. Compression preserves meaning | Summaries reflect where the conversation ended up and trace back to it | PASS — FR-012 | PASS — summaries built from the node's full own messages; `through_message_id` links each label to its source (data-model) |
| VI. History is data | Build order preserved | PASS — FR-025 | PASS — timestamps on all rows; replaced replies and all summaries kept append-only (R9) |

No violations. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-branching-chat-map/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── http-api.md      # Local HTTP API (route handlers)
│   └── ai-provider.md   # AI boundary + fake provider
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
src/
├── app/                      # Next.js App Router
│   ├── page.tsx              # Empty state / last opened node
│   ├── n/[nodeId]/page.tsx   # Chat view
│   ├── map/page.tsx          # Map view (mounts MapRenderer)
│   └── api/                  # Route handlers → thin wrappers over src/server
├── components/
│   ├── chat/                 # Message list, selection → branch, markers, inherited context
│   └── common/
├── map/
│   ├── MapRenderer.ts        # Imperative PixiJS scene (no React inside)
│   ├── layout/               # Per-tree tidy layout, origin allocation, overlap check
│   └── forestGraph.ts        # graphology model built from GET /api/forest
├── state/                    # Zustand: per-node scroll + draft, view mode
├── shared/                   # Zod schemas and types shared by client and server
└── server/                   # Framework-free domain logic
    ├── db/                   # Kysely + pg setup, migrations/
    ├── forest/               # Trees, nodes, branching, markers, inherited context
    ├── messages/             # Send, retry, regenerate rules
    ├── summaries/            # Refresh queue, append-only summaries
    └── ai/                   # AIProvider interface, FakeAIProvider (Claude later)

tests/
├── unit/                     # layout, selectors, domain rules
├── integration/              # src/server + route handlers on the test database
└── e2e/                      # Playwright user stories (quickstart scenarios)
```

**Structure Decision**: A single Next.js project at the repository root, with framework-free
domain logic in `src/server/` and the imperative map in `src/map/`, and a
`docker-compose.yml` at the root for Postgres. One language (TypeScript) throughout.

## Deferred / Open Items

- **AI layer** (R10): SDK and streaming transport, summary trigger timing (check against
  SC-003), background job mechanism, context size for deep branches. Built against the fake
  provider until decided.

## Complexity Tracking

No constitution violations; nothing to justify.
