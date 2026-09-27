# Farabi

Branch a new, independent conversation from any highlighted phrase, and see every conversation
as a map of trees.

## Using it

- **Chat**: replies stream in as they're written; **Stop** keeps what's arrived so far.
- **Branch**: highlight any text and choose **Branch**, or send exactly `????` to branch from
  your last message (it's resent as the new branch's first message).
- **Definitions**: highlight a term and choose **Send to definitions** for a short AI draft
  (general meaning + how your conversation used it). Every occurrence of a collected term is
  underlined; hover it for the card. Confirm or edit drafts in the **Definitions** tab.
- **Map**: drag a tree by its root, or any other node on its own. Click a line to label it.
  Click a node to open its conversation. Specs, plan and tasks live in `specs/001-branching-chat-map/`; project rules
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

## Projects

Each project is its own map, with its own conversations and definitions. Use the 🗂 menu at the
left of the top bar to create a project, switch between projects, or move one to the trash. The
trash only hides a project; restore it from the same menu. Everything saves automatically.

## Feedback

The **Feedback** button in the top bar opens a drawer over any view. Type a note, add tags, paste
or drop screenshots, and submit; the current view (and conversation, if one is open) is recorded.
Drag items to reorder them, filter by tag, and resolve or reopen them. Nothing is ever deleted.

Everything is exported to `feedback/FEEDBACK.md` after each change, with screenshots under
`feedback/attachments/`. The folder is git-ignored; set `FEEDBACK_DIR` to move it. Claude Code
reads that file and, after doing the work for an item, marks it addressed:

```bash
npm run feedback:addressed -- <item id>   # open → addressed; you confirm or reopen it in the app
npm run feedback:export                   # rewrite FEEDBACK.md from the database
```

## Test

```bash
npm run lint && npm run typecheck
npm test                     # unit + integration (needs Docker Postgres, migrated test DB)
npm run test:e2e             # Playwright against a production build on port 3100
npm run seed:large           # 500 nodes across 20 trees, for trying the map at scale
                             # (add `-- --feedback 200` for 200 feedback items too)
```
