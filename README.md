# Farabi

Branch a new, independent conversation from any highlighted phrase, and see every conversation
as a map of trees. Specs, plan and tasks live in `specs/001-branching-chat-map/`; project rules
are in `.specify/memory/constitution.md`.

## Prerequisites

- Node.js 22 or newer and npm
- Docker (local Postgres 17 with pgvector)

## Run

```bash
npm install
cp .env.example .env.local   # DATABASE_URL, TEST_DATABASE_URL, AI_PROVIDER=fake
docker compose up -d         # Postgres on 127.0.0.1:5432 (also creates farabi_test)
npm run db:migrate           # add `-- --test` for the test database
npm run dev                  # http://127.0.0.1:3000
```

### Claude

Set `AI_PROVIDER` in `.env.local`, then restart `npm run dev`:

- `claude-code`: uses your local Claude Code login, so replies count against your Claude
  subscription rather than API billing. For personal, local use only. Each reply runs
  `claude -p` with tools disabled, in an empty folder, with any API key removed from its
  environment. Pair it with `SUMMARY_TRIGGER=map` so labels refresh only when you open the map.
- `claude`: the Claude API with `ANTHROPIC_API_KEY` (billed per use), model `claude-opus-5`
  (override with `CLAUDE_MODEL`).
- `fake`: deterministic replies and summaries; the automated tests always use it.

## Test

```bash
npm run lint && npm run typecheck
npm test                     # unit + integration (needs Docker Postgres, migrated test DB)
npm run test:e2e             # Playwright against a production build on port 3100
npm run seed:large           # 500 nodes across 20 trees, for trying the map at scale
```
