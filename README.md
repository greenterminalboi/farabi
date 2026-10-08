# Farabi

Ask, then branch from any phrase. Every question and answer is part of one canvas per project:
conversations read as columns, and every tangent fans out beside them.

## Using it

- **Ask**: type in the composer and press Enter. Replies stream in; **Stop** keeps what has
  arrived. In an empty project, the first message starts a tree; **New tree** in the canvas menu
  starts another. The composer sits under whatever is focused: click a frame (its border or
  header, not its text) to focus it. Drafts are kept per element, across reloads.
- **Branch**: highlight any text, in an answer or in your own message, and choose **Branch**. A
  new, unsent edge appears beside it with a marker on the highlighted words; type your question
  (or keep the highlighted text) and send. Send exactly `????` from an answer to ask its question
  again as a sibling. Click a marker to go to its branch.
- **Park**: highlight text and choose **Park** to save a tangent for later. The side panel's
  **Parked** tab fires it as a branch whenever you're ready; **Branches** lists what leaves the
  focused element, newest first.
- **Retry and regenerate**: an unfinished reply offers **Retry**, a finished one ↻. Both add a new
  attempt beside the old one; nothing is replaced, and branches stay where they were.
- **Suggestions**: a grey dotted line under a reply's bold text marks places worth branching from.
  Click one to select it. Toggle them in the canvas menu.
- **Definitions**: highlight a term and choose **Define** for a short AI draft (general meaning +
  how your conversation used it). Every occurrence is underlined; hover it for the card. Confirm
  or edit drafts in the **Definitions** tab; **Source** jumps back to where the term came from.
- **Moving around**: the mouse wheel or a two-finger scroll pans; Ctrl/Cmd + wheel (or a pinch)
  zooms. Text stays real, selectable text at every zoom. `Alt+↑/↓/←/→` walks to the parent, the
  first child or a sibling, and `/` jumps to the composer. The camera follows what you send or walk
  to, and stays put once you pan by hand. The minimap (bottom right) shows the whole project; click
  or drag in it to move. Hide it with its ×.
- **Arranging**: drag a frame to move one element, or Alt-drag (or drag a tree's first message)
  to move the whole tree. Focus a message to add a short **note** to it.
- **Functions**: ƒ on an answer runs **Analogy**. Its output is AI material, marked as such:
  **Confirm**, **Reject** (hidden unless **Show rejected** is on) or **Run again** for another.
  The ⚙ on the function's label overrides its settings for that run only.

Specs, plan and tasks live in `specs/`; v0.2 is `specs/010-v02-message-graph-canvas/`. Project
rules are in `.specify/memory/constitution.md`.

## Desktop app

Farabi is becoming a desktop app for macOS and Windows (feature 011). The installer brings
everything it needs: no Postgres, Node or anything else. See
[docs/desktop-install.md](docs/desktop-install.md) for installing, first steps, and where data and
logs live (`~/Library/Application Support/app.farabi/` and `~/Library/Logs/app.farabi/` on macOS,
`%APPDATA%\app.farabi\` and `%LOCALAPPDATA%\app.farabi\logs\` on Windows).

For development: `npm run desktop:dev` runs the app from source with its data in `.farabi-dev/`
(needs Rust), and `npm run desktop:build` makes the installer for this machine. Until the switch-over,
the web app below and the repo scripts keep using Postgres; pass `--data-dir <folder>` to point a
script (`feedback:addressed`, `feedback:export`, `db:migrate`, `desktop:import`) at a desktop data
folder instead. With the app open, the scripts go through it.

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
  environment.
- `claude`: the Claude API with `ANTHROPIC_API_KEY` (billed per use), model `claude-opus-5`
  (override with `CLAUDE_MODEL`).
- `fake`: deterministic replies; the automated tests always use it.

## Settings

The ⚙ button in the top bar opens Settings. Both reply settings apply to every new reply.
Definitions and suggestions aren't affected. The page also holds each function's settings (for
example Analogy's reach and length); changing them never runs anything.

- **Reply detail**: a 10-step slider from Brief to Exhaustive (five bands of two steps). The
  default is 8 (Detailed). An explicit request in your message ("keep it short") still wins.
- **Reply model**: Default (whatever `CLAUDE_MODEL` or `CLAUDE_CODE_MODEL` configures), Claude
  Opus 5, Opus 5.5, Fable 5.1, Sonnet 5 or Haiku 4.5.

Each reply is labelled with the settings it was written with, for example "Detailed · 8 · Claude
Opus 5". Changing a setting never relabels older replies, and every change is kept.

## Projects

Each project is its own canvas, with its own trees and definitions. Use the 🗂 menu at the
left of the top bar to create a project, switch between projects, or move one to the trash. The
trash only hides a project; restore it from the same menu. Everything saves automatically.

## Feedback

The **Feedback** button in the top bar opens a drawer over any view. Type a note, add tags, paste
or drop screenshots, and submit; the open project and the focused element are recorded.
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
npm run seed:large           # a "Scale seed" project of 5,000 elements in 20 trees
                             # (`-- --elements N`, `-- --feedback 200`, `-- --outputs 20`)
```

## Upgrading from v0.1

v0.2 replaces conversations with a graph of questions and answers. `npm run db:migrate` converts
everything in one transaction:

```bash
npm run db:migrate   # backs up first (db/backups/<time>-pre-0010.dump), then migrates and converts
npm run v1:verify    # checks text, reply context, counts and that the originals are unchanged
npm run v1:convert   # safe to rerun: reports 0 new rows
```

The original tables move, untouched and read-only, into the `v1` schema. The backup uses
`pg_dump` through `docker compose`, a local `pg_dump`, or the Postgres image; if none works the
migration stops without changing anything (`-- --no-backup` skips it). Old `/n/<id>` links still
open the right place on the canvas.
