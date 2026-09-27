# Quickstart & Validation: Branching Chat with Map View

How to run the app and prove each user story works. Behavior details live in
[spec.md](./spec.md), [data-model.md](./data-model.md) and [contracts/](./contracts/).

## Prerequisites

- Node.js 22 LTS or newer and npm
- Docker (for local Postgres 17 + pgvector)
- A current desktop browser

## Run

```bash
npm install
docker compose up -d     # Postgres 17 + pgvector on localhost:5432
npm run db:migrate       # apply migrations (also enables the vector extension)
npx tsx scripts/migrate.ts --test   # same for the test database
npm run dev              # open http://127.0.0.1:3000; fake AI provider
npm test                 # unit + integration (Vitest, test database)
npm run test:e2e         # Playwright, production build on :3100, GPU Chromium
```

`AI_PROVIDER=fake` is the default until the AI layer is decided (research R10).

## Validation scenarios

Each maps to a user story in the spec and should exist as a Playwright test.

1. **Root conversation (Story 1)** — Empty database → start conversation → send "Tell me
   about Kubernetes Pods" → AI reply appears. Start a second root. Map shows two separate
   trees, both styled as roots. Restart the server and reload the browser → both still there (FR-026).
2. **Branch (Story 2)** — In the first root, highlight "Containers" in the AI reply → Branch.
   New conversation opens showing the quoted anchor and the inherited parent context,
   read-only and set apart (FR-033), waiting for input (FR-004). Back in the parent, a marker
   sits on exactly "Containers"; clicking it opens the child. Branch the same message again on
   an overlapping selection → two markers, two children (FR-007). Branch from the child →
   third level works (FR-008).
3. **Map (Story 3)** — Switch to map: 5 nodes, lines to parents, roots distinct, two separate
   trees, labels show "AI"-marked summaries or neutral placeholders (FR-011, FR-014).
   Record every node's position, add a branch in tree 1, confirm tree 2's positions are
   unchanged (SC-007).
4. **Round trip (Story 4)** — Scroll up in a long conversation and type an unsent draft → map
   → click the same node → same scroll position and draft (SC-005). Click another node →
   that conversation opens.
5. **Drift (Story 5)** — Branch, then send messages that move to a new topic; after the reply
   the map label reflects the latest messages (fake provider summarizes the last message).
   Make the fake provider slow → typing in chat is unaffected (FR-013).
6. **Regenerate rules** — Regenerate the latest AI reply → new reply shown, old one kept in the
   database with `replaced_at`. Branch from the new reply → regenerate is no longer offered;
   calling the API returns `409 has_branches` (FR-029, FR-030).
7. **AI unavailable** — Switch the fake provider to fail → sending shows an error with retry,
   the draft is kept, map and browsing still work (FR-032).
8. **Scale** — Seed 500 nodes across 20 trees (`npm run seed:large`) → map opens and a node click
   opens its conversation within 1 s (SC-006).

## Constitution spot checks

- No UI or API path deletes or merges nodes (Article II): `grep` route handlers for DELETE → none.
- Every summary row has `provenance = 'ai_suggested'`; the map never renders it in the
  user-authored style (Article I).
- No AI-initiated branch or suggestion appears anywhere (Article IV).
