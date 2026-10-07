# Implementation Plan: Farabi as a Native Desktop App

**Branch**: `011-tauri-desktop-app` (work currently sits on `v0.2`, alongside feature 010) |
**Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/011-tauri-desktop-app/spec.md`

## Summary

Farabi ships as an installable app for macOS and Windows, built on Tauri v2, and the web app is
retired. Nothing else has to be installed.

The Rust shell owns the window, the app's lifecycle and every OS integration:

- one instance at a time, and window state;
- the Keychain and Credential Manager, native dialogs, and revealing the data folder.

The existing Next.js server runs unchanged as a **bundled Node sidecar** (research R1, R3) on a
loopback port that only the app's own window can use, guarded by a per-launch secret (R4). It
talks to Rust over a private stdio channel (R5).

Postgres-in-Docker is replaced by **PGlite**, Postgres compiled to WASM and stored in the app's
data folder (R2). All migrations, triggers and SQL keep working, so the provenance and history
guarantees are enforced the same way.

Settings that lived in `.env` move into the app. The API key goes to the OS credential store
(R8). Claude Code stays an optional provider, found on disk without relying on the shell `PATH`.
A one-time import brings the existing web-app database across (R11).

Because feature 010 is being built in parallel, both backends and both launch modes coexist until
cut-over. Cut-over happens when the desktop app passes the whole e2e suite on both operating
systems (R13).

## Technical Context

**Language/Version**: TypeScript 6 on Node 24 LTS for the server and UI (bundled Node for users,
system Node for development). Rust 1.9x stable, 2021 edition, for the Tauri shell.

**Primary Dependencies**:

- Existing: Next.js 16, React 19, Kysely, PixiJS 8, `@anthropic-ai/sdk`.
- Tauri v2 with `tauri-plugin-single-instance`, `-window-state`, `-dialog` and `-opener`
  (R12).
- `keyring` (Rust, R8), `@electric-sql/pglite` and `@electric-sql/pglite-pgvector`, using
  Kysely's built-in `PGliteDialect` (R2).
- `@tauri-apps/cli` (dev).
- WebdriverIO with the embedded WebDriver plugin for Tauri (dev, native smoke tests, R7).

**Storage**:

- Desktop: PGlite in `<app data>/store/`, with automatic pre-upgrade backups in `backups/` (R10).
- Until cut-over: Postgres 17 through `pg` for the web app. One Kysely interface over both
  (data-model.md).

**Testing**:

- Vitest over a `STORE=pglite|pg` matrix (pglite needs no Docker).
- Playwright `chromium`, `webkit` and `desktop-windows` (CDP into WebView2).
- WebdriverIO native smoke on macOS and Windows.
- GitHub Actions `macos-latest` and `windows-latest` (R7).

**Target Platform**:

- macOS 13+ (arm64 and x64, separate DMGs) on WKWebView.
- Windows 10 21H2+ and 11 x64 (NSIS) on WebView2.

**Project Type**: desktop app: a Tauri shell around the existing Next.js server and UI.

**Performance Goals**:

- SC-003: ready for input ≤ 3 s from a cold start; an existing canvas opens ≤ 1 s.
- SC-005 (010 SC-005): pan and zoom p95 ≤ 16.7 ms at 5,000 elements on both engines. Verified
  first by gate G1.
- SC-010 of 010: time to the first words of a reply is unchanged.

**Constraints**:

- Installer < 100 MB (SC-002, about 70 MB estimated).
- No listener beyond `127.0.0.1`, and none usable without the session secret (FR-003).
- The API key is never in files or logs (SC-008).
- Writes stay atomic across a forced quit (SC-007, gate G2).
- Unsigned builds (FR-021).
- No native Node modules, so one JavaScript bundle serves every target.

**Scale/Scope**:

- One user and one device.
- Stores up to 010's scale proof (5,000 elements per project) and beyond.
- 28 existing route handlers and 10 migrations carried over unchanged, plus about 3 new routes.
- One new Rust crate (`src-tauri/`) of roughly 1–1.5k lines.

## Gates (run before the tasks that depend on them)

| Gate | Proves | Blocks | Fallback if it fails |
|------|--------|--------|----------------------|
| **G1 – Shell spike** | The launch handshake (R4), streaming in WKWebView and WebView2, and 010's 5,000-element scale proof at p95 ≤ 16.7 ms in the macOS webview (R6) | Everything after Setup | Stop and review with the owner: fix the WebKit hot path, or a Chromium runtime under Tauri (costs SC-002) |
| **G2 – Store durability** | G2a: 50 process kills, zero committed-row loss. G2b: whether commits are fsynced. G2c: 10 VM hard resets (R2) | Storage tasks and import | G2a fails: embedded native Postgres. G2b or G2c fails: owner decides (R2, options a and b) |
| **G3 – Parity matrix** | The Vitest suite passes on both `pg` and `pglite` (R7) | Making PGlite the desktop default | Fix the dialect or type parsers until it passes |

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design (below).*

| Article | Bearing on this feature | Status |
|---------|-------------------------|--------|
| **I. The user is the final authority** | Provenance (`ai-suggested` / `user-confirmed` / `user-authored`) is stored in columns and enforced by triggers. PGlite keeps the same SQL and triggers (R2). The import copies provenance values unchanged, compares checksums (R11, SC-006), and disables triggers only to stop them refiring on rows already validated at the source. The feedback rule (the CLI marks only `open` → addressed, and only the user confirms or reopens) is kept through the new route (R9). | Pass |
| **II. Growth is additive, never reconciled** | The import works only into an empty store and never merges or dedupes (R11). Upgrades never delete; they back up first (R10). Uninstalling keeps data unless the user ticks a box (R12). No deletion happens as a side effect. | Pass |
| **III. Nothing is invented ahead of evidence** | No AI behavior changes. The provider plumbing moves, the prompts do not. | Pass (not affected) |
| **IV. User-led exploration first** | No suggestion behavior changes. | Pass (not affected) |
| **V. Compression preserves meaning** | No summarization or compression changes. | Pass (not affected) |
| **VI. History is data** | The build history (element timestamps, settings history, feedback state history) is preserved byte for byte by the import and by upgrades. The new settings (provider, model, feedback folder) are explicit user instructions stored in the existing append-only history, never used as evidence about how the user learns (Article VI, 1.0.1 clarification). | Pass |

No violations, so Complexity Tracking is limited to the one structural addition below.

## Project Structure

### Documentation (this feature)

```text
specs/011-tauri-desktop-app/
├── plan.md              # This file
├── research.md          # Phase 0 (R1–R13)
├── data-model.md        # Phase 1: store backends, data dir, settings keys, import runs
├── quickstart.md        # Phase 1: validation scenarios V1–V12
├── contracts/
│   ├── host-bridge.md   # Rust ↔ server stdio protocol
│   ├── launch-session.md# port, secret, cookie, proxy rules, runtime.json
│   ├── http-additions.md# new and changed routes
│   └── cli.md           # npm scripts against the desktop store
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
src-tauri/                         # NEW: Tauri v2 shell (Rust)
├── Cargo.toml
├── tauri.conf.json                # identifier app.farabi, externalBin node, resources server/, NSIS + DMG
├── capabilities/default.json      # minimal: no IPC exposed to the remote (loopback) origin
├── binaries/                      # node-<target-triple>[.exe], fetched at build (git-ignored)
├── icons/
└── src/
    ├── main.rs                    # plugins, single instance, window state, boot sequence
    ├── sidecar.rs                 # pick port, spawn node, stdio bridge, supervise, shutdown
    ├── bridge.rs                  # host-bridge message types and handlers
    ├── credentials.rs             # keyring get/set/delete
    ├── paths.rs                   # data dir, logs, runtime.json, lock
    └── screens.rs                 # boot or failure page (newer-data, store-locked, server crashed)

src/
├── proxy.ts                       # NEW: session-secret + Host check (desktop mode only)
├── instrumentation.ts             # + start host bridge, run startup migrations/backup in desktop mode
├── app/
│   ├── __farabi/session/route.ts  # NEW: exchange secret → cookie
│   ├── api/host/…                 # NEW: credentials, reveal, pick-folder, claude-code status, import
│   ├── api/feedback/[id]/addressed/route.ts   # NEW (R9)
│   └── settings/                  # + provider, API key, Claude Code status, feedback folder, data folder, import
└── server/
    ├── db/client.ts               # backend selection (pg | pglite)
    ├── db/storeLock.ts            # NEW: exclusive store.lock (pid), close-on-exit
    ├── db/startup.ts              # NEW: version guard, backup, migrate (R10)
    ├── db/importWeb.ts            # NEW: one-time import (R11)
    ├── host/bridge.ts             # NEW: stdio bridge client; no-op fallback in web mode
    ├── ai/claudeCode.ts           # + discovery, Windows .cmd handling, status probe (R8)
    ├── ai/claude.ts               # API key from bridge, else env
    └── settings/                  # + new keys and precedence (R8)

scripts/
├── env.ts                         # target resolution: pg | live app | closed store (R9)
├── desktop/fetch-node.ts          # NEW: pinned Node download + checksum
├── desktop/prepare-server.ts      # NEW: standalone build → src-tauri resources
├── desktop/import.ts              # NEW: npm run desktop:import
└── desktop/durability.ts          # NEW: gate G2 kill harness

tests/
├── unit/, integration/            # existing; run over STORE matrix
├── e2e/                           # existing Playwright; + webkit + desktop-windows projects
└── desktop/                       # NEW: WebdriverIO native smoke

docs/desktop-install.md            # NEW: unsigned first-launch steps (FR-021)
.github/workflows/desktop.yml      # NEW: build + test on macos-latest and windows-latest
```

**Structure Decision**: The repo stays a single Next.js project. A standard Tauri v2 `src-tauri/`
crate is added at the root. Server and UI code stay where they are, so feature 010's tasks keep
their paths. Desktop-only behavior sits behind `FARABI_HOST=tauri` (server) and the host bridge,
never behind UI branches. Everything added for parallel running (the `pg` dialect, Docker files,
web-mode env handling) is listed for removal at cut-over (R13).

## Coordination with feature 010 (FR-024)

- **Lanes**: coordination goes through `/Users/halda/Projects/farabi-coord/STATUS.md`. This lane
  owns `src-tauri/*`, packaging and the local data store. `src/server/db/*` belongs to the v0.2
  lane, so the dialect, backend selection and startup-migration changes there go in only after
  they are logged and agreed. The DB engine change (PGlite) MUST be logged there before any code
  changes it.
- **Migrations** load from the static list `src/server/db/migrationList.ts`. 0010 is v0.2's,
  0011 is drill's (feature 012), and **0012_desktop** is this feature's (assigned 2026-10-07).
  They merge in that order. All run on both backends, and G3 catches any Postgres feature PGlite
  lacks.
- **The PGlite proposal is accepted provisionally** (2026-10-07 12:15), on three conditions:
  - pgvector is loaded;
  - the `client.ts` edit is a backend switch only, landed after v0.2 commits 0010 (done:
    `d0ac962`);
  - the full integration suite passes on both backends before cut-over.
- **010 R3 backup** (`docker compose exec pg_dump`): `scripts/migrate.ts` picks the backup method
  by backend (R10). 010's rule ("refuse without a backup") is kept.
- **010 e2e and performance tests** also run under the `webkit` project from now on. A failure
  there is a desktop-parity bug that 011 owns, unless it comes from a new 010 behavior. Then it is
  fixed in that 010 task.
- **New 010 server code** must not read `process.env` for user settings directly. It goes through
  `getSettings()` or the config resolver (R8), so the desktop app picks it up.

## Post-design Constitution Re-check

Phase 1 didn't change the result:

- data-model.md adds `import_runs` (an append-only audit record) and four settings keys in the
  existing append-only history;
- no entity gains merge, dedupe or automatic deletion behavior;
- provenance columns and triggers are untouched.

All six articles still **Pass**.

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
|----------|------------|--------------------------------------|
| Two store backends and two launch modes until cut-over | FR-024 and FR-025: 010 keeps developing on the web app while desktop parity is built | A big-bang switch would block 010 or leave it testing on a platform it doesn't ship on |
| A bundled Node runtime inside a Tauri app | Keeps all server TypeScript (and 010's coming work) as it is, with no runtime for the user to install | A Rust rewrite duplicates 010's work while it is being written (R1) |
