# Contract: npm Scripts Against the Desktop Store

This contract covers how repo scripts reach Farabi's data once it lives in the desktop app
(research R9).

## Target resolution (`scripts/env.ts`)

| Order | Condition | Target |
|-------|-----------|--------|
| 1 | `DATABASE_URL` is set | Postgres via `pg`, as today. Removed at cut-over |
| 2 | `runtime.json` exists in the data dir, and its `pid` is alive | **Live app**: HTTP to `http://127.0.0.1:<port>` with `Authorization: Bearer <secret>` |
| 3 | Otherwise | **Closed store**: take `store.lock` and open PGlite in `<data dir>/store/` directly |

The data dir is `FARABI_DATA_DIR` if set, otherwise the platform default (data-model.md §2).
`--data-dir <path>` overrides both.

## Scripts

| Script | Live app | Closed store | Notes |
|--------|----------|--------------|-------|
| `npm run feedback:addressed -- <id>` | `POST /api/feedback/{id}/addressed` | `markAddressed()` directly | The output text and exit codes are unchanged. The `CLAUDE.md` workflow is unaffected (FR-020) |
| `npm run feedback:export` | `POST /api/feedback/export` (regenerate) | Regenerates into the stored `feedback_export_dir` | — |
| `npm run db:migrate` | Refuses: "Quit Farabi first; it migrates its own data on start." exit 2 | Backup, then migrate (data-model.md §6) | `--test` keeps targeting the test DB |
| `npm run seed:large` | Refuses (exit 2) | Seeds | — |
| `npm run v1:convert`, `v1:verify` | Refuse (exit 2) | Run | Backup rule from 010 R3, via the backend-appropriate method |
| `npm run desktop:import -- [connectionString]` | `POST /api/host/import` | Imports directly | The default source is `postgres://farabi:farabi@127.0.0.1:5432/farabi` |

## New developer scripts

| Script | Does |
|--------|------|
| `npm run desktop:dev` | `tauri dev`. The shell spawns `next dev` with the host bridge and `FARABI_DATA_DIR=.farabi-dev` |
| `npm run desktop:build` | Runs `fetch-node`, then `next build` (standalone), `prepare-server` and `tauri build` for the host target. Prints the installer path and size |
| `npm run desktop:durability` | Gate G2 harness. `--kills N` (G2a, default 50), `--fsync-probe` (G2b report), `--writer-only` / `--verify` (G2c VM resets). Exit 0 only if every check passed |
| `npm run test:desktop` | WebdriverIO native smoke against the built app |

**Exit codes**: `0` success, `1` failure, and `2` for "refused: app is running" or "refused: data
is locked".
