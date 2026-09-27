# Research: Branching Chat with Map View

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-09-26

The stack was supplied by the user. Items below record each decision, why it holds up
against the spec and constitution, and what was rejected. Items marked **Deferred** were
explicitly postponed by the user and are designed around, not decided.

## R1. Application shell and runtime

- **Decision**: One Next.js (App Router) application in React + TypeScript, run locally and used
  in the user's own browser at `http://localhost:3000`. Server-side logic runs in Next.js route
  handlers on the Node.js runtime, with all domain logic in a plain TypeScript `src/server/`
  module that does not import Next.js, so it can move to a separate Node service later.
- **Rationale**: Single user, single device, no sign-in (FR-027). A local Next.js server plus a
  browser tab meets that with the user's stack and nothing to package.
- **Local hardening**: The server binds to `127.0.0.1` only. API route handlers reject requests
  whose `Host` is not `localhost`/`127.0.0.1` or whose `Origin` (when present) is not the app's
  own origin, so other websites open in the same browser cannot call the local API.
- **Alternatives considered**: Tauri desktop shell — tried and dropped by the user in favour of
  the browser. A separate Node backend — rejected for v1; the `src/server/` boundary keeps the
  option open.

## R2. Storage and tree queries

- **Decision**: Postgres 17 with pgvector, run locally via Docker Compose (the official
  `pgvector/pgvector` image) with a named volume for data. Plain adjacency-list model
  (`nodes.parent_id`); subtree and ancestor-chain queries use recursive CTEs. Query building and
  migrations via **Kysely** (typed SQL builder with `withRecursive` support); migrations are
  plain, forward-only files.
- **Rationale**: The user chose Postgres. Adjacency lists fit an additive, never-reconciled
  forest (Article II): creating a branch is a single insert and never rewrites other rows.
  Recursive CTEs cover the two queries this feature needs (whole forest for the map; ancestor
  chain for inherited context). Data stays on the user's machine (FR-027).
- **Alternatives considered**: Embedded PGlite — only needed for the dropped desktop build.
  Materialized paths / nested sets — rejected: nested sets rewrite rows on insert; paths add
  maintenance for no v1 benefit. Prisma — rejected: recursive CTEs end up as raw SQL anyway.

## R3. pgvector

- **Decision**: Enable the `vector` extension in the first migration. No vector columns or
  indexes are created in v1.
- **Rationale**: User direction: future connection, coupling and notation-pattern features
  will need embeddings, and this avoids a separate vector store later. Enabling the extension
  has no behavioral effect on this feature.
- **Constitution note**: Any future use of embeddings for connections or coupling is bound by
  Article III — similarity between the user's own nodes may only be *evidence*, never a
  stand-in for general-knowledge relatedness. Not relevant to v1.

## R4. Map data structure and per-tree layout

- **Decision**: **graphology** holds the forest in the client (one directed graph; node
  attributes carry `treeId`). Layout is computed **per tree** with a tidy-tree algorithm
  (Reingold–Tilford via `d3-hierarchy`'s `tree()`), fed from graphology traversal. Each tree
  has a persisted origin (`trees.layout_origin_x/y`), assigned when the tree is created in the
  first free region. When a node is added, only that tree's layout is recomputed. If a tree's
  new bounding box would overlap another tree, **only the growing tree** is relocated to the
  next free region; other trees never move.
- **Rationale**: Satisfies FR-023 / SC-007 strictly (other trees never move) and the user's
  "per connected component, not global" requirement. graphology has no tidy-tree layout of its
  own, so a small, dedicated layout step is used; graphology stays the source of structure.
- **Alternatives considered**: Force-directed layout over the whole forest (graphology
  ForceAtlas2) — rejected: global and non-deterministic, moves unrelated trees. Packing trees
  side by side and re-packing on growth — rejected: moves neighbours.

## R5. Map rendering

- **Decision**: **PixiJS v8** (WebGL) canvas, owned by an imperative `MapRenderer` class that
  React mounts once and then drives through method calls (`setForest`, `updateSummary`,
  `focusNode`). React never re-renders the scene. Pan/zoom via a viewport helper
  (`pixi-viewport`). Text labels use Pixi `Text`/`BitmapText`.
- **Rationale**: User direction — future zoom-tier rendering (text → notation → symbols,
  depth texture) needs custom draw logic that React Flow / Sigma.js don't support well.
  500+ nodes (SC-006) is well within WebGL's comfortable range.
- **Alternatives considered**: React Flow, Sigma.js — rejected by the user for the reason above.
- **Design notes**: Root vs branch nodes use distinct shape/fill (FR-019). AI summaries render
  with an "AI" marker and distinct text style; placeholders use a third, neutral style
  (FR-011, FR-014).

## R6. Branch anchors and markers in message text

- **Decision**: A marker stores the message id plus a **text-position selector** (character
  start/end offsets into the message's stored text) and a **text-quote selector** (exact anchor
  text plus ~32 characters of prefix/suffix), following the W3C Web Annotation selector model.
  Offsets are taken against the message's raw stored text; the chat view maps DOM selections to
  raw offsets through the renderer's source positions.
- **Rationale**: Messages are immutable (FR-028) and messages with markers cannot be
  regenerated (FR-029), so offsets stay valid forever. The quote selector gives a check and a
  fallback if rendering of the same text changes between app versions.
- **Overlapping markers**: Markers may overlap or nest (edge case: selection across an existing
  marker). The chat view renders overlapping ranges as layered highlights; each marker stays
  individually clickable.
- **Alternatives considered**: Offsets against rendered DOM text only — rejected: fragile
  across renderer changes. Embedding marker tokens into message text — rejected: mutates
  messages, which FR-028 forbids.

## R7. Client state across chat ↔ map

- **Decision**: A small client store (**Zustand**) holds per-node view state: scroll position
  and unsent draft text, keyed by node id, kept in memory for the session. The map renderer
  stays mounted (hidden) when the user is in chat view, so switching views is instant.
- **Rationale**: FR-022 / SC-005 require round trips to preserve position and draft. The spec
  requires persistence across restarts only for conversations and structure (FR-026), not for
  drafts or scroll position.
- **Alternatives considered**: Persisting drafts to the database — unnecessary for the spec;
  can be added later.

## R8. Provenance model (Article I)

- **Decision**: A Postgres enum `provenance` with values `ai_suggested`, `user_confirmed`,
  `user_authored`, stored on every object that is AI-produced or AI-touched, and on structural
  objects for uniformity: summaries (`ai_suggested`), AI messages (`ai_suggested`), user
  messages (`user_authored`), nodes and branch markers (`user_authored`). Provenance is a
  separate column from content, never inferred from text (FR-015).
- **Rationale**: Makes the Article I distinction queryable, so future features (saturation,
  derivations) can filter by provenance without a migration.

## R9. History (Article VI)

- **Decision**: All rows carry `created_at`. Messages replaced by regeneration are kept with a
  `replaced_at` timestamp and `replaced_by` link (FR-030). Summaries are append-only: each
  regeneration inserts a new row; the current summary is the latest.
- **Rationale**: FR-025 / FR-030 and Article VI (history is data). Append-only summaries also
  keep each label traceable to the message it was generated through (Article V).
- **Not included**: Logging node visits ("what was returned to") — not required by the spec;
  would need a spec change first.

## R10. AI integration — **Partly decided (2026-09-27)**

- **Decided**: Anthropic TypeScript SDK (`@anthropic-ai/sdk`) behind the existing `AIProvider`
  boundary (`src/server/ai/claude.ts`), selected with `AI_PROVIDER=claude`. Model
  `claude-opus-5` (override with `CLAUDE_MODEL`), adaptive thinking (the model's default).
  Server-side refusal fallback on (`fallbacks: "default"`, beta
  `server-side-fallback-2026-07-01`). Key from `ANTHROPIC_API_KEY` in `.env.local`, read only on
  the server.
  - **Replies**: streamed from the API (`stream().finalMessage()`, `max_tokens` 64000) so long
    answers don't time out; the finished reply is stored and returned. A branch's inherited
    context and anchor go in a second system block after a stable first block (cacheable
    prefix); automatic prompt caching is on.
  - **Summaries**: one request at `effort: "low"`, own messages + anchor only (FR-012).
  - **Errors**: network, rate limit, 5xx, bad or missing credentials, and a refusal even after
    fallback all map to `AIUnavailableError`, which the app already shows as "unavailable, retry".
- **Claude Code provider (2026-09-27)**: for personal use on the user's Claude subscription,
  `AI_PROVIDER=claude-code` runs the local `claude -p` CLI (JSON output, tools/MCP/slash commands
  off, empty working directory, API credentials stripped from its environment). It takes one
  prompt, so the conversation is sent as a transcript. With `SUMMARY_TRIGGER=map`, labels are
  refreshed when the map opens (`POST /api/summaries/refresh-stale`) instead of after every
  reply, halving subscription usage; SC-003's "within 10 s of a reply" then becomes "shortly
  after opening the map".
- **Still open**: streaming replies *to the browser* (the user's direction was Vercel AI SDK
  over SSE); summary trigger timing (currently after each completed reply, matching FR-012); a
  durable job mechanism instead of the in-process queue; context size for deep branches.

## R11. Testing

- **Decision**: **Vitest** for unit tests (layout, selectors, domain rules); Vitest against the
  Docker Postgres (separate test database, migrated once, each test in a rolled-back
  transaction) for integration tests of the server module and route handlers; **Playwright** for end-to-end user stories, using the fake AI
  provider. Map assertions in Playwright read a test hook exposing node positions (for SC-007)
  rather than comparing pixels.
- **Alternatives considered**: Jest — Vitest is faster and native to the TypeScript/ESM setup.

## R12. Validation

- **Decision**: **Zod** schemas for every route handler's input and output, shared between
  client and server.
- **Rationale**: One definition of each contract in [contracts/http-api.md](./contracts/http-api.md).
