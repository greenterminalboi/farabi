---
description: "Task list for Feature 011: Farabi as a Native Desktop App (Tauri)"
---

# Tasks: Farabi as a Native Desktop App

**Input**: design documents in `specs/011-tauri-desktop-app/`: [spec.md](./spec.md),
[plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/host-bridge.md](./contracts/host-bridge.md),
[contracts/launch-session.md](./contracts/launch-session.md),
[contracts/http-additions.md](./contracts/http-additions.md),
[contracts/cli.md](./contracts/cli.md) and [quickstart.md](./quickstart.md).

**Tests**: included, as in earlier features. The spec's success criteria (SC-004, SC-006, SC-007,
SC-008) and the plan's gates require them. Write each story's tests first and watch them fail.

**Format**: `[ID] [P?] [Story] Description`. `[P]` means the task can run in parallel, because it
touches different files and has no unfinished dependencies.

**Before starting**:

- **Work only in the worktree `/Users/halda/Projects/farabi-011-tauri`**, on branch
  `011-tauri-desktop-app`. Never edit the v0.2 checkout (`/Users/halda/Projects/farabi`).
- **Coordination**: read `/Users/halda/Projects/farabi-coord/STATUS.md` before each phase. Append
  a line when you finish a phase, get blocked, or touch a shared contract. Use the format
  `- YYYY-MM-DD HH:MM [tauri] message`.
- **Files owned by other lanes**: `src/server/db/*`, `src/shared/schemas.ts`, `src/shared/kinds/*`,
  `src/server/graph/*` and `src/canvas/*` belong to the v0.2 lane. This feature's approved edits
  there are limited to:
  - the backend switch in `client.ts`;
  - the `0012_desktop` migration and its `migrationList.ts` entry;
  - additive `SettingKey` and table types in `schema.ts`;
  - additive schemas in `schemas.ts`.

  Log each one in STATUS.md when it lands. Anything else in those files needs the coordinator's
  OK first.
- **Next.js**: read `node_modules/next/dist/docs/` before writing routes, `proxy.ts` or
  standalone output (`AGENTS.md`). Middleware is now `proxy.ts` in Next 16.
- **Gate failures**: G1, G2 or G3 failing means stop, log it, and wait. Do not work around a
  failed gate.

---

## Phase 1: Setup

**Purpose**: bring the branch up to the shared contracts, and scaffold the Tauri crate and build
scripts.

- [X] T001 Rebase `011-tauri-desktop-app` onto the current `v0.2` head, so the branch has commit
  `d0ac962` or later. That brings in `src/server/db/migrationList.ts`, migration 0010 and the v2
  graph. Run `npm ci && npm run typecheck && npm test` (Postgres via `docker compose up -d`), then
  log the rebased commit in STATUS.md.
- [X] T002 Add the dependencies in `package.json`, then run `npm install`:
  - `@electric-sql/pglite` and `@electric-sql/pglite-pgvector`, pinned to the exact matching
    versions (the pgvector package has an exact peer dependency);
  - dev dependencies `@tauri-apps/cli@^2`, `@wdio/cli`, `@wdio/local-runner`, `@wdio/mocha-framework`
    and `@wdio/tauri-service` (research R7).
- [X] T003 [P] Scaffold `src-tauri/` as a Tauri v2 crate: `Cargo.toml`, `build.rs`,
  `src/main.rs` (empty builder for now), `icons/` (generate them with `npx tauri icon` from
  `public/` art, or a placeholder), and `capabilities/default.json`. The capabilities file grants
  **no** permissions to remote URLs (research R5).
- [X] T004 [P] Create `src-tauri/tauri.conf.json` with:
  - `identifier: "app.farabi"`, `productName: "Farabi"`;
  - `bundle.targets: ["dmg", "nsis"]`;
  - `bundle.externalBin: ["binaries/node"]` and `bundle.resources: { "../.desktop/server": "server" }`;
  - the NSIS `installMode: "currentUser"`, with the WebView2 `downloadBootstrapper`;
  - `app.windows: []` (the window is created in code, T016);
  - no `devUrl` or `frontendDist` server (the starting page is a bundled asset, T017).
- [X] T005 [P] Update `.gitignore` with `src-tauri/target/`, `src-tauri/binaries/`, `.desktop/`
  and `.farabi-dev/`.
- [X] T006 [P] Write `scripts/desktop/fetch-node.ts`. It downloads the official Node 24 LTS
  binary for the host target, or `--target <triple>`, from nodejs.org, using a version and
  SHA-256 pinned in the script. It verifies the checksum and writes
  `src-tauri/binaries/node-<target-triple>[.exe]`, then makes the file executable. It is
  idempotent and skips the download when the checksum already matches.
- [X] T007 Make standalone output opt-in in `next.config.ts`: set
  `output: process.env.FARABI_STANDALONE === "1" ? "standalone" : undefined`, so `next start` (the
  web app and Playwright `chromium`) is unchanged. Add `@electric-sql/pglite` and
  `@electric-sql/pglite-pgvector` to `serverExternalPackages`. Run
  `FARABI_STANDALONE=1 npx next build` and confirm `.next/standalone/server.js` exists.
- [X] T008 Write `scripts/desktop/prepare-server.ts`. It:
  - copies `.next/standalone/` to `.desktop/server/`, and `.next/static/` to
    `.desktop/server/.next/static/` and `public/` to `.desktop/server/public/`;
  - verifies `pglite.wasm`, `pglite.data` and the pgvector tarball are present under
    `.desktop/server/node_modules/@electric-sql/`, copying them from `node_modules` if tracing
    missed them (research `farabi-coord/research/2026-10-07-pglite.md`, "Not verified").

  Fail loudly if any asset is missing.
- [X] T009 Add npm scripts to `package.json` (contracts/cli.md):
  - `desktop:dev`: `tauri dev`;
  - `desktop:build`: fetch-node, then `FARABI_STANDALONE=1 next build`, prepare-server and
    `tauri build`, then print the installer path and size in MB;
  - `desktop:durability`, `desktop:import` and `test:desktop`.

---

## Phase 2: Foundational (blocking)

**Purpose**: the shell, the private session, the stdio bridge and the store backend, proven by
gates G1–G3. No user story starts until this phase is done and all three gates pass.

### Server-side bridge and session

- [X] T010 [P] Write `tests/unit/f11-bridge.test.ts` (fails first). Cover:
  - line framing and the `v: 1` envelope;
  - request and response matching by `id` and `re`, and timeouts (`code: "timeout"`);
  - lines over 1 MiB are rejected;
  - the `hello` gate (messages before `hello` are ignored);
  - in web mode, the fallbacks in contracts/host-bridge.md ("Rules") are used.

  Drive it with in-memory streams.
- [X] T011 Implement `src/server/host/bridge.ts` per contracts/host-bridge.md. It exports:
  - `isDesktop()`, which is true when `FARABI_HOST === "tauri"`;
  - `startBridge(stdin, stdout)`, `request(type, params, timeoutMs)`, `emit(event, data)` and
    `onRequest(type, handler)`;
  - typed helpers `getCredential`, `setCredential`, `deleteCredential`, `pickFolder`, `reveal`
    and `focusWindow`, with the web-mode fallbacks.

  In desktop mode it redirects `console.log` and `console.info` to stderr. The instance is cached
  on `globalThis` (as `client.ts` does), so hot reload doesn't open a second bridge.
- [X] T012 [P] Implement `src/server/host/redact.ts`. Its `redact(text)` replaces any occurrence
  of the current API key or session secret, if known, with `[redacted]`. Wrap the stderr writer
  that T011 installs with it. Unit tests go in `tests/unit/f11-redact.test.ts`.
- [X] T013 [P] Write `tests/unit/f11-proxy.test.ts` (fails first). It calls the exported proxy
  function with constructed requests and covers every row of the "Request rules" table in
  contracts/launch-session.md:
  - `421` for a wrong `Host`;
  - `401` without a cookie or bearer;
  - the session path is exempt;
  - `403` for a state-changing request with a foreign `Origin`;
  - pass-through when `FARABI_HOST` is unset.
- [X] T014 Implement `src/proxy.ts`, following the Next 16 docs at
  `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`, with the rules in
  contracts/launch-session.md. The session secret and port come from a server-only module that
  T011 fills on `hello`. Comparisons are constant-time. Add the response headers (the CSP draft
  from the contract) to every response.
- [X] T015 Implement `src/app/__farabi/session/route.ts`. `GET ?t=` checks `t` against the secret
  in constant time. On a match it sets
  `farabi_session=<secret>; HttpOnly; SameSite=Strict; Path=/` and returns `303` to `/`, with
  `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Otherwise it returns `401` with an
  empty body.

### Rust shell

- [X] T016 Implement `src-tauri/src/main.rs` and `src-tauri/src/paths.rs`:
  - `paths.rs` resolves the data dir (`app_data_dir()`, overridden by `FARABI_DATA_DIR`) and the
    log dir, and creates both.
  - `main.rs` registers the plugins `single-instance` (focus the existing window), `window-state`,
    `dialog` and `opener`.
  - It creates the main window in code, starting on the bundled starting page.
  - It adds the standard app menu with Edit (Undo, Redo, Cut, Copy, Paste, Select All) so ⌘ and
    Ctrl shortcuts work (FR-009).
  - It installs a navigation handler: any `http(s)` URL not on `127.0.0.1:<port>` opens in the
    default browser instead (launch-session.md, "Window behavior").
- [X] T017 [P] Create `src-tauri/assets/` with the built-in pages `starting.html`,
  `blocked.html?screen=…` and `fatal.html`. They are plain HTML with inline CSS and follow the
  app's light and dark tokens. The texts are:
  - starting: "Starting Farabi…";
  - `newer-data`: "This data was written by a newer version of Farabi. Install the newer version
    to open it. Nothing has been changed.";
  - `store-locked`: "Farabi is already using this data.";
  - `backup-failed`: "Farabi couldn't back up your data before upgrading, so it didn't upgrade.
    Nothing has been changed.";
  - `upgrade-failed`: "The upgrade failed. Your data was restored from the backup taken just
    before.";
  - `fatal`: "Farabi stopped", with **Restart** and **Open logs** buttons.
- [X] T018 Implement `src-tauri/src/sidecar.rs`:
  - bind `127.0.0.1:0`, read the port and drop the listener;
  - generate a 32-byte secret (OS RNG), base64url-encoded;
  - spawn the server:
    - **release**: the `node` sidecar with `<resources>/server/server.js`;
    - **`cfg(debug_assertions)`**: system `node` running `node_modules/next/dist/bin/next dev -H
      127.0.0.1 -p <port>` in the repo root, with `FARABI_DATA_DIR=<repo>/.farabi-dev`.

    The environment is exactly what contracts/launch-session.md step 4 lists, with no secret or
    key.
  - Pipe stdin and stdout to the bridge (T019), and stderr to a rotating log file in the log dir
    (5 MB × 5).
  - Keep a 20 s ready timeout, which shows `fatal.html`.
  - On an unexpected exit, show `fatal.html` and auto-restart at most once per 60 s.
  - On window close or quit, send `shutdown`, wait up to 5 s, then kill.
- [X] T019 Implement `src-tauri/src/bridge.rs`: serde types for the request, response and event
  envelopes in contracts/host-bridge.md, a line reader and writer over the child's stdio, and a
  pending-request map with timeouts. It handles:
  - **incoming**: `ready` (navigate to `http://127.0.0.1:<port>/__farabi/session?t=<secret>`),
    `blocked` (show `blocked.html?screen=`) and `fatal`;
  - **outgoing**: `hello` sent right after spawn, and `shutdown`.

  Requests from the server are dispatched to the handlers in T041 (credentials), T057 (dialog)
  and T058 (reveal). Until those exist, they answer `{ ok: false, error: { code: "unsupported" } }`.
- [X] T020 Wire the bridge into `src/instrumentation.ts`. When `NEXT_RUNTIME === "nodejs"` and
  `isDesktop()`, it calls `startBridge(process.stdin, process.stdout)`, waits for `hello`, runs
  the startup sequence (T029), and then emits `ready { port, schemaLevel }`. The existing
  `regenerateFeedbackFile()` call stays, and runs after the store is ready.

### Gate G1: shell spike (quickstart V1)

- [ ] T021 Run quickstart V1 on macOS with `npm run desktop:dev`, against the current Postgres
  backend (`DATABASE_URL` from `.env.local`; PGlite is not needed for G1):
  - check the `curl` `401` and `421` responses;
  - check that a fake reply streams token by token and that Stop keeps the partial text;
  - run `npm run seed:large`, pan the 5,000-element project for 10 s, and record the p95 from
    the in-page frame probe (010 M0).

  Record the results in `specs/011-tauri-desktop-app/gates.md`. **Pass**: p95 ≤ 16.7 ms
  (SC-005). Log the result in STATUS.md. **If it fails, stop**, log it, and wait for the owner's
  decision (research R6).
- [ ] T022 Run quickstart V1 on Windows (WebView2), on a Windows machine or VM with GPU
  acceleration. Record the results in `gates.md` and log them.
- [X] T023 Tune the CSP in `src/proxy.ts` to the narrowest policy that the production build
  (`desktop:build`) runs under with no console CSP violations, on both engines. Record the final
  policy in contracts/launch-session.md, replacing the draft line.

### Store backend and gates G2 and G3

- [X] T024 [P] Implement `src/server/db/storeLock.ts`:
  - `acquireStoreLock(dataDir)` creates `store.lock` with exclusive-create (`wx`), containing
    `{ pid, startedAt }`. If the file exists and its pid is alive, it throws `StoreLockedError`.
    If the pid is dead, it replaces the file.
  - `releaseStoreLock()` removes it.

  Unit tests go in `tests/unit/f11-store-lock.test.ts`: a live lock, a stale lock, and release.
- [X] T025 Change `src/server/db/client.ts` to a **backend switch only** (coordinator condition
  (2); log it in STATUS.md when it lands):
  - `createDb(target)`, where `target` is `{ kind: "pg", url }` or
    `{ kind: "pglite", dataDir: string | "memory://" }`.
  - **pg**: the existing pool and the `setTypeParser(700)` are unchanged.
  - **pglite**: `new PGlite(dataDir, { extensions: { vector } })`, using Kysely's built-in
    `PGliteDialect`, with type parsers equal to `pg`'s:
    - OID 700 parsed to `number`;
    - `timestamptz` to `Date`;
    - `jsonb` parsed;
    - `int8` and `numeric` as strings.

    For a disk store, `acquireStoreLock` runs first. Register `close()` on `SIGTERM`, `SIGINT`
    and `shutdown`: `await pglite.close()`, then release the lock.
  - `getDb()` picks `pg` when `DATABASE_URL` is set, otherwise `pglite` when `FARABI_DATA_DIR`
    is set, otherwise it throws the existing error.
  - The instance stays cached on `globalThis`, so `next dev` hot reload never opens a second
    PGlite on the same directory (PGlite issue #1106).
- [X] T026 Make the Vitest setup backend-aware, in `vitest.config.ts`, `tests/integration/setup.ts`
  and `tests/integration/helpers.ts`:
  - `STORE=pg` (default until cut-over) keeps today's `TEST_DATABASE_URL` behavior.
  - `STORE=pglite` uses a fresh `memory://` PGlite per test file, migrated through
    `migrationList.ts`.

  Add npm scripts `test:pg` and `test:pglite`.
- [X] T027 **Gate G3** (quickstart V3): run `npm run test:pg` and `npm run test:pglite`. Fix any
  parser or dialect difference in `client.ts` only, never by changing tests or SQL owned by
  another lane. Record identical pass counts in `gates.md`, then log in STATUS.md. Coordinator
  condition (3) is met when this holds at cut-over (T077).
- [X] T028 Write `scripts/desktop/durability.ts` (contracts/cli.md):
  - **`--kills N`** (G2a): spawn a child that opens a disk PGlite in a temp dir and, in a loop,
    inserts project, element and setting rows through `createDb`, appending each committed id to
    a side log with `fsync` after each commit. It also streams an answer through the fake
    provider's checkpoint path. After a random 0.2–3 s, the parent sends `SIGKILL` (on Windows,
    `TerminateProcess`). The parent then reopens the store, runs consistency queries
    (`SELECT count(*)` on every table, `amcheck`-style index checks where PGlite supports them,
    and every side-logged id present), and repeats N times.
  - **`--fsync-probe`** (G2b): run a commit loop and print how to trace fsync syscalls on this OS.
    It also tries starting PGlite without `-F` (custom `startParams` if the API allows) and
    reports whether that worked.
  - **`--writer-only` / `--verify`** (G2c): the writer and checker halves of G2a, for VM resets.

  Exit 0 only if everything passed.
- [X] T029 Implement `src/server/db/startup.ts`, the desktop-mode startup sequence (data-model.md
  §6), for now without the backup step, which is added in T072:
  1. acquire the lock, or emit `blocked { screen: "store-locked" }`;
  2. compare the executed migrations with `migrationList.ts`. If any are unknown, emit
     `blocked { screen: "newer-data" }` and write nothing;
  3. run pending migrations;
  4. write `runtime.json` (data-model.md §5, mode `0600`, owner-only ACL on Windows);
  5. return the schema level.

  On `shutdown`:
  1. stop live generations the way Stop does;
  2. wait up to 3 s for checkpoints;
  3. close the store;
  4. remove `runtime.json` and the lock;
  5. exit 0.
- [ ] T030 **Gate G2** (quickstart V2): run `npm run desktop:durability -- --kills 50` on macOS
  and Windows, and `--fsync-probe` on both. Run G2c in a macOS VM and a Windows VM. Record
  everything in `gates.md` and log it in STATUS.md.
  - **G2a fails**: stop. The fallback is embedded native Postgres (research R2), which needs a
    new task list from the coordinator.
  - **G2a passes but G2b or G2c fails**: log the owner's choice of R2 option (a) or (b) as
    "needs decision", and continue. Storage tasks don't depend on the choice. T074 implements
    option (b) only if chosen.
- [X] T031 [P] Add a Playwright `webkit` project to `playwright.config.ts`. It reuses the
  existing tests and `webServer` (production build, `next start`, Postgres), so 010's work is
  checked on WebKit as it lands (research R6). Run it once, and file each WebKit-only failure as a
  line in `gates.md` under "WebKit parity backlog". They are fixed in US2 (T042).

**Checkpoint**: G1, G2 (at least G2a) and G3 pass, and STATUS.md is updated. The user stories can
begin.

---

## Phase 3: User Story 1 — Install and use Farabi with nothing else installed (P1) 🎯 MVP

**Goal**: one installer per platform. The app opens on a clean machine, creates its own store,
and a fake reply streams with nothing else installed.

**Independent test**: quickstart V4 on a clean macOS account and a clean Windows VM.

### Tests (write first)

- [ ] T032 [P] [US1] Write `tests/desktop/specs/f11-us1-first-launch.e2e.ts` (WebdriverIO with
  `@wdio/tauri-service` and the embedded WebDriver plugin, research R7). With a fresh temp
  `FARABI_DATA_DIR`, launch the built app and check:
  - the window shows the canvas with an empty project within 3 s (SC-003);
  - `<data dir>/store/` and `runtime.json` exist;
  - sending "hello" with the fake provider shows a streamed reply.

  Add `tests/desktop/wdio.conf.ts`, and add the `tauri-plugin-wdio-webdriver` to `src-tauri` as
  debug and test only (`cfg(feature = "e2e")`).
- [X] T033 [P] [US1] Write `tests/integration/f11-first-launch.test.ts`. It runs `startup.ts`
  against an empty `memory://` store and a temp dir, then checks that:
  - every migration in `migrationList.ts` ran;
  - `runtime.json` has the data-model §5 shape;
  - the default project exists after the first `GET /api/projects` (existing behavior);
  - `ai_provider` resolves to `"fake"` when no row and no env exist.

### Implementation

- [X] T034 [US1] Make the desktop default provider `fake` until a key or provider is chosen: in
  `src/server/ai/index.ts`, resolve the provider through the config resolver (T055) when it
  exists. Until then, use `isDesktop() ? "fake" : process.env.AI_PROVIDER`. Note the dependency
  on T055 in the code comment.
- [X] T035 [US1] Finish packaging in `src-tauri/tauri.conf.json` and `scripts/desktop/`:
  - `desktop:build` produces `Farabi_<version>_aarch64.dmg` or `_x64.dmg` on macOS, and
    `Farabi_<version>_x64-setup.exe` on Windows;
  - the server runs from `<resources>/server/server.js` with the bundled `node` sidecar.

  Verify on a machine with **no system Node on PATH** (`env -i` launch on macOS) that the app
  still starts.
- [X] T036 [US1] Add a size check to `scripts/desktop/prepare-server.ts` and the `desktop:build`
  script. After `tauri build`, print each installer's size, and fail if one is ≥ 100 MB (SC-002).
- [X] T037 [P] [US1] Write `docs/desktop-install.md`. It covers:
  - download and install on each platform;
  - the first-launch steps for an unsigned app: on macOS, right-click → Open, or
    `xattr -dr com.apple.quarantine /Applications/Farabi.app`; on Windows, SmartScreen → More info
    → Run anyway (FR-021);
  - where the data lives (data-model.md §2);
  - that uninstalling keeps data.
- [ ] T038 [US1] Run quickstart V4 on a clean macOS account and a clean Windows VM. Record the
  installer sizes, the cold-start time and the time from download to first reply in `gates.md`.
  Log it in STATUS.md.

**Checkpoint**: an installable app works end to end with the fake provider. This is the MVP.

---

## Phase 4: User Story 2 — Everything works as it does in the web app (P1)

**Goal**: every web-app capability behaves the same in the desktop app on WKWebView and WebView2.

**Independent test**: quickstart V5, where the e2e suite passes on `webkit` and
`desktop-windows`, and the native smoke tests pass.

### Tests (write first)

- [X] T039 [P] [US2] Add Playwright projects to `playwright.config.ts`:
  - **`webkit-desktop`**: `webServer` runs the packaged standalone server
    (`node .desktop/server/server.js`) with `FARABI_HOST` unset, `FARABI_DATA_DIR=.farabi-e2e`
    (wiped before each run) and the existing test env (`AI_PROVIDER=fake`, test hooks). Browser:
    WebKit.
  - **`desktop-windows`** (Windows only, skipped elsewhere): `globalSetup` launches the built app
    with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` and a temp data dir,
    then the tests attach with `chromium.connectOverCDP("http://127.0.0.1:9222")`.

    Add a fixture in `tests/e2e/fixtures.ts` that uses the attached page instead of `page.goto`
    when this project runs.
- [ ] T040 [P] [US2] Write `tests/desktop/specs/f11-us2-native.e2e.ts`:
  - ⌘C/Ctrl+C copies selected canvas text, checked by reading the system clipboard through the
    test plugin;
  - an external link opens outside the app window;
  - the Edit menu exists;
  - the dyslexia font renders (computed `font-family`).

### Implementation

- [X] T041 [US2] Implement credential handling in `src-tauri/src/credentials.rs` (it is used by
  US4, but bridge dispatch needs it for parity tests that enter a key). Use the `keyring` crate
  with service `app.farabi`, and an allow-list containing only the name `anthropic-api-key`.
  `get { reveal }` returns `{ present, value? }`; `set` and `delete` are idempotent. Register it in
  the `bridge.rs` dispatch. Unit tests go in the Rust `#[cfg(test)]` block, using a mock keyring
  backend.
- [X] T042 [US2] Run `--project=webkit-desktop` and fix the failures. Work through the "WebKit
  parity backlog" in `gates.md` (T031):
  - **WebKit engine differences** in files this lane owns: fix them here.
  - **Differences in `src/canvas/*` or the text layer** (v0.2-owned): log a precise repro in
    STATUS.md for v0.2, and do not edit those files.

  Done when the suite is green or every remaining failure is logged as handed to v0.2.
- [ ] T043 [US2] Run `--project=desktop-windows` on Windows and fix the failures, with the same
  ownership rule as T042.
- [ ] T044 [US2] Run quickstart V5's manual checks on the reference hardware on both platforms:
  selection and copy at the closest and furthest zoom, and the SC-005 frame probe. Record them in
  `gates.md`.

**Checkpoint**: SC-004 parity is met for the app as it stands. It is re-run at cut-over (T077).

---

## Phase 5: User Story 3 — Keep my existing data (P1)

**Goal**: a one-time, all-or-nothing import of the web-app Postgres database. Ids, timestamps and
provenance are kept, the import never merges, and repeating it is refused.

**Independent test**: quickstart V6.

### Tests (write first)

- [X] T045 [P] [US3] Write `tests/integration/f11-import.test.ts`. The source is the `pg` test
  database, filled with the existing fixtures (`tests/integration/fixtures.ts`) and covering every
  table. The destination is a `memory://` PGlite. Check that:
  - check returns `ready` with counts;
  - the import succeeds, `checksumsMatch` is true, and every table's rows are equal, including
    `provenance` and `created_at`;
  - a second import is refused with `already_imported`;
  - an import into a non-empty destination is refused with `destination_not_empty`;
  - a source one migration behind is refused with `schema_behind`, and one ahead with
    `schema_ahead`;
  - an injected failure mid-copy (a test hook that throws after N tables) leaves the destination
    empty and writes an `import_runs` row with `outcome = 'failed'`;
  - attachment files are copied to `<data dir>/feedback/attachments/<item id>/`.

  This file runs only when both `TEST_DATABASE_URL` and PGlite are available.

### Implementation

- [X] T046 [US3] Write migration `src/server/db/migrations/0012_desktop.ts` and register it as
  `"0012_desktop"` in `src/server/db/migrationList.ts`, after `0011_drill` if present. Log it in
  STATUS.md. It must:
  1. Drop and recreate the `setting_changes` key `CHECK` to allow
     `'information_pressure', 'reply_model', 'ai_provider', 'default_model', 'summary_trigger',
     'feedback_export_dir', 'claude_code_path'`, with per-key value checks:
     - `ai_provider`: `value #>> '{}' IN ('claude','claude-code','fake')`;
     - `default_model`: a string, or JSON `null` to go back to the default;
     - `summary_trigger`: `IN ('reply','map')`;
     - `feedback_export_dir` and `claude_code_path`: a string or JSON `null`.
  2. Create `import_runs` with columns `id uuid DEFAULT gen_random_uuid()`,
     `source_system_identifier text NOT NULL`, `source_label text NOT NULL`,
     `schema_level text NOT NULL`, `started_at timestamptz NOT NULL`, `finished_at timestamptz`,
     `outcome text NOT NULL CHECK (outcome IN ('succeeded','failed'))`, `counts jsonb NOT NULL`,
     `checksums_match boolean`, `error text`,
     `provenance provenance NOT NULL DEFAULT 'user_authored' CHECK (provenance = 'user_authored')`.
  3. Add an append-only trigger copying the `setting_changes_append_only` pattern.

  Extend `SettingKey` and add `ImportRunsTable` in `src/server/db/schema.ts` (additive only).
- [X] T047 [US3] Implement `src/server/db/importWeb.ts` (research R11, data-model.md §4):
  - `checkImport({ connectionString, attachmentsDir })` and
    `runImport({ connectionString, attachmentsDir })`;
  - the source is a short-lived `pg.Client`; the destination is the app's PGlite `db`;
  - check the preconditions (zero `projects` and `feedback_items`, no succeeded run for the same
    `system_identifier`, equal migration lists);
  - in one destination transaction:
    - run `SET LOCAL session_replication_role = replica`;
    - copy each table in foreign-key order (query the order from `pg_constraint`; do not
      hard-code it), batched 500 rows at a time, column for column;
    - reset sequences;
    - compare counts and per-table ordered `md5(string_agg(t::text, '|' ORDER BY <pk>))`;
    - roll back if anything differs;
  - copy attachment files, verifying sizes;
  - write the `import_runs` row in its own transaction afterwards, for both outcomes;
  - strip the password from `source_label`.
- [X] T048 [P] [US3] Add the routes `src/app/api/host/import/check/route.ts` and
  `src/app/api/host/import/route.ts`, per contracts/http-additions.md "Import". Add zod schemas
  (additive) in `src/shared/schemas.ts`. They return `501 unsupported` in web mode.
- [X] T049 [P] [US3] Write `scripts/desktop/import.ts` (`npm run desktop:import -- [conn]`).
  - **App live**: the bearer HTTP call to `/api/host/import`.
  - **App closed**: open the store directly (after T068's target resolution) and run
    `runImport`.

  Print the counts and checksum result. Exit codes follow contracts/cli.md.
- [X] T050 [US3] Add **Settings → Data → Import from the web app** in `src/app/settings/`:
  - a connection-string field, defaulting to `postgres://farabi:farabi@127.0.0.1:5432/farabi`;
  - an optional attachments folder picker (T057);
  - a **Check** button that shows counts or the refusal reason in plain words;
  - an **Import** button with a blocking progress state, then a result summary.

  The section is shown only in desktop mode.
- [ ] T051 [US3] Run quickstart V6 against a restored copy of the owner's real database, never
  the live one. Record the result in `gates.md` (SC-006).

**Checkpoint**: the owner's existing work can move into the desktop app.

---

## Phase 6: User Story 4 — Configure Farabi inside the app (P2)

**Goal**: every `.env` setting is in Settings, the API key is in the OS credential store, Claude
Code is found without the shell `PATH`, and AI actions without a usable provider explain
themselves.

**Independent test**: quickstart V7 and V8.

### Tests (write first)

- [X] T052 [P] [US4] Write `tests/integration/f11-settings.test.ts`. Check that:
  - the resolver precedence is row, then env, then default, for each key in data-model.md §3;
  - `PUT /api/settings` appends rows and rejects invalid values with the `CHECK` messages;
  - `feedback_export_dir` must be an existing, writable folder (otherwise `422
    folder_not_writable`);
  - `GET /api/settings` returns `{ value, source, changedAt }` for every key.
- [X] T053 [P] [US4] Write `tests/integration/f11-provider-ready.test.ts`. For every route that
  starts AI work (send, ask, branch, define, function runs), with the provider `claude` and no
  key, expect `422 provider_not_ready` with `reason: "no_api_key"`. No question edge or pending
  answer is created (count rows before and after). Repeat with `claude-code` and discovery stubbed
  to `not_found` and `signed_out`.
- [X] T054 [P] [US4] Write `tests/unit/f11-claude-code-discovery.test.ts`. Use a fake filesystem
  and process runner to check:
  - the candidate order from research R8 on macOS and Windows;
  - `.cmd` handling builds `cmd.exe /d /s /c` with arguments quoted;
  - the probe maps `--version` failure to `not_found`, and a stream-json auth error to
    `signed_out`;
  - `childEnv()` still strips `ANTHROPIC_*`, `CLAUDECODE` and `CLAUDE_CODE_*`.

### Implementation

- [X] T055 [US4] Implement `src/server/settings/config.ts`. `getConfig(key)` and
  `getAllConfig()` resolve the newest `setting_changes` row, then the env variable
  (`AI_PROVIDER`, `CLAUDE_MODEL`/`CLAUDE_CODE_MODEL`, `SUMMARY_TRIGGER`, `FEEDBACK_DIR`,
  `CLAUDE_CODE_BIN`), then the default (data-model.md §3). In desktop mode, env values are ignored
  for user settings: the defaults are `ai_provider: "fake"` and `feedback_export_dir: null`.
  Export a `setConfig(key, value)` that appends a row. Then replace every direct `process.env` read
  of those variables in `src/server/` (ai, summaries, feedback) with the resolver. Log in STATUS.md
  that other lanes should use it (already announced).
- [X] T056 [US4] Extend `GET` and `PUT` in `src/app/api/settings/route.ts` for the new keys, per
  contracts/http-additions.md "Settings", with zod schemas added to `src/shared/schemas.ts`. A
  valid `feedback_export_dir` change triggers `regenerateFeedbackFile()`.
- [X] T057 [P] [US4] Implement `dialog.pickFolder` in `src-tauri/src/bridge.rs` with
  `tauri-plugin-dialog` (folder mode, title and default path from params), and the route
  `src/app/api/host/pick-folder/route.ts` (`purpose` enum per contract).
- [X] T058 [P] [US4] Implement `shell.reveal` in `src-tauri/src/bridge.rs` with
  `tauri-plugin-opener`. Reject any path not under the data, log or export dir with `forbidden`.
  Also add the routes `src/app/api/host/reveal/route.ts` (`target: "data" | "logs" | "export"`)
  and `src/app/api/host/info/route.ts`.
- [X] T059 [US4] Add the API key routes in `src/app/api/host/api-key/route.ts` (`GET` presence,
  `PUT` with the value trimmed to 20–512 chars and optional `?verify=1`, `DELETE`). In
  `src/server/ai/claude.ts`, build the client with `getCredential({ reveal: true })` in desktop
  mode, falling back to `ANTHROPIC_API_KEY` in web mode. Rebuild it on the `credentials.changed`
  event. Register the key with `redact.ts` (T012) as soon as it is read. The key is never logged,
  persisted or returned.
- [X] T060 [US4] Implement Claude Code discovery and status in `src/server/ai/claudeCode.ts` and a
  new `src/server/ai/claudeCodeDiscovery.ts` (research R8):
  - the candidate order;
  - the login-shell lookup with a 3 s timeout;
  - Windows `.cmd` spawning;
  - `probe()` returning `{ status, path, version, checkedAt }`, cached 60 s.

  Replace the module-level `CLAUDE_BIN` constant with the resolved path at call time. Keep
  `WORKDIR`, `childEnv()` and tools-disabled exactly as they are. Add the route
  `src/app/api/host/claude-code/route.ts` (`?refresh=1`).
- [X] T061 [US4] Add a `providerReady()` guard in `src/server/ai/index.ts` and call it at the
  start of each AI-starting route handler, before any write. It returns the `422
  provider_not_ready` body from contracts/http-additions.md. In the UI, the composer and the
  define and function actions keep their text, show the reason, and link to
  `/settings#provider`.
- [X] T062 [US4] Update `src/app/settings/` with the following sections:
  - **Provider**: Claude API, Claude Code (shown with its status: *Found · signed in*, *Found ·
    signed out* or *Not found*, plus **Recheck** and **Choose file…**) and Fake;
  - **API key**: save with verify, *Key saved*, remove;
  - **Default model** (the summary trigger was dropped: v0.2 removed `SUMMARY_TRIGGER` as dead code in b54929e);
  - **Feedback export folder**: **Choose…**, the current path, and the last export error if any;
  - **Data**: the data and log folders with **Show in Finder/Explorer**.

  In web mode, the controls that need the shell become text fields, or are hidden.
- [ ] T063 [US4] Run quickstart V7 and V8 on both platforms, launching from the Dock or Start
  menu for V8. Record the results, including the SC-008 `grep`, in `gates.md`.

**Checkpoint**: there is no `.env` dependency for users, and the Claude Code subscription path
works from the installed app.

---

## Phase 7: User Story 5 — Feedback still reaches the development loop (P2)

**Goal**: feedback export goes to a chosen folder with its attachments mirrored, and
`npm run feedback:addressed` works whether the app is open or closed.

**Independent test**: quickstart V9.

### Tests (write first)

- [X] T064 [P] [US5] Write `tests/integration/f11-feedback-export.test.ts`. Check that:
  - attachments are written under `<data dir>/feedback/attachments/` in desktop mode;
  - regeneration writes `FEEDBACK.md` and mirrors referenced attachments into
    `<export dir>/attachments/`;
  - a missing export dir leaves the item saved, and the last export error is reported by
    `GET /api/settings`;
  - stored paths containing `..` are rejected.
- [X] T065 [P] [US5] Write `tests/unit/f11-cli-target.test.ts` for `scripts/env.ts` resolution
  (contracts/cli.md table): `DATABASE_URL` wins, a live `runtime.json` pid selects HTTP, a stale or
  missing one selects the closed store, and `--data-dir` overrides. Also check exit code 2 for
  refusing scripts while live.

### Implementation

- [X] T066 [US5] Split feedback paths in `src/server/feedback/paths.ts`:
  - `attachmentAbsPath` resolves under `<data dir>/feedback/` in desktop mode, and under
    `FEEDBACK_DIR` in web mode (unchanged);
  - the export target comes from `getConfig("feedback_export_dir")`.

  In `src/server/feedback/exportFile.ts`, write `FEEDBACK.md` to the export dir and mirror the
  referenced attachment files, copying only missing or changed files. If the export dir is `null`,
  skip the export. If it is missing or unwritable, record the error for Settings and never fail
  the save. Keep the existing advisory lock (harmless on one connection).
- [X] T067 [US5] Add the route `src/app/api/feedback/[id]/addressed/route.ts` per
  contracts/http-additions.md "Feedback". It wraps `markAddressed()` and returns `200` addressed,
  `409` not_open or `404`. It is reachable only with Bearer auth in desktop mode (`proxy.ts`
  already enforces this). Also add `src/app/api/feedback/export/route.ts` (`POST` to regenerate).
- [X] T068 [US5] Rewrite target resolution in `scripts/env.ts` per contracts/cli.md (`pg`, live
  app or closed store, plus `--data-dir`). Export `withTarget({ live, closed, refuseWhenLive })`.
  Then update the scripts:
  - `scripts/feedback-addressed.ts`: live calls the new route; closed calls `markAddressed`.
    Output and exit codes are unchanged.
  - `scripts/feedback-export.ts`: live posts to the export route; closed regenerates.
  - `scripts/migrate.ts`, `scripts/seed-large.ts`, `scripts/v1-convert.ts` and
    `scripts/v1-verify.ts`: refuse when live, with exit 2 and the message "Quit Farabi first; it
    migrates its own data on start." `migrate.ts` picks its backup method by backend (T069).
- [ ] T069 [US5] Run quickstart V9 with the export folder set to the repo's `feedback/`, and check
  the CLAUDE.md workflow end to end with the app open and with it closed. Record the result in
  `gates.md`.

**Checkpoint**: the development feedback loop works on the desktop app.

---

## Phase 8: User Story 6 — Updates and installs feel like a normal app (P3)

**Goal**: one instance, remembered window state, upgrades that back up first, a guard against
newer data, and an uninstall that keeps data.

**Independent test**: quickstart V10 and V11.

### Tests (write first)

- [X] T070 [P] [US6] Write `tests/integration/f11-upgrade.test.ts` against a disk PGlite in a temp
  dir. Check that:
  - with a pending migration, `startup.ts` creates `backups/<ts>-pre-<name>/`, the backup opens,
    and then the migration runs;
  - with a migration that throws, the store is restored from the backup, and the screen is
    `upgrade-failed`;
  - an unknown executed migration gives `newer-data`, and file mtimes are unchanged;
  - only the 5 newest automatic backups are kept.
- [ ] T071 [P] [US6] Write `tests/desktop/specs/f11-us6-native.e2e.ts`:
  - a second launch focuses the existing window and no new process stays alive;
  - window size and position persist across a restart;
  - the window is clamped on-screen when the saved position is off-screen (write the
    window-state file by hand before launch).

### Implementation

- [X] T072 [US6] Add the backup step to `src/server/db/startup.ts` (data-model.md §6, research
  R10). Before running pending migrations, while the store is closed:
  1. copy `store/` to `backups/<UTC YYYYMMDDTHHMMSSZ>-pre-<first pending migration>/`;
  2. open the copy read-only to verify it, then close it;
  3. on copy failure, emit `blocked backup-failed`;
  4. on migration failure, close the store, replace `store/` with the backup, and emit
     `blocked upgrade-failed`;
  5. prune to the 5 newest `-pre-` backups.

  Make `scripts/migrate.ts` (closed store) use the same function. This covers 010 R3's backup rule
  on PGlite.
- [X] T073 [US6] Configure the NSIS uninstaller in `src-tauri/tauri.conf.json` and an NSIS
  template hook (`src-tauri/windows/hooks.nsh`): add an unchecked "Also delete my Farabi data"
  checkbox. If it is ticked, remove `%APPDATA%\app.farabi`. Otherwise keep it (FR-023). On macOS,
  document in `docs/desktop-install.md` that dragging to the Trash keeps the data.
- [X] T074 [US6] **Required** (coordinator, 2026-10-07 12:40: fsync is off, so scheduled
  backups are mandatory whatever G2 shows). Implement automatic snapshots in
  `src/server/db/snapshots.ts`. While the store has changed, every 10 minutes and on clean quit,
  run `dumpDataDir()` gzipped to `backups/auto-<ts>.tar.gz`, keeping the newest 6. Add a
  **Settings → Data → Restore from snapshot…** flow (quit, `loadDataDir`, relaunch) with a test in
  `tests/integration/f11-snapshots.test.ts`.
- [ ] T075 [US6] Run quickstart V10, V11 and V12 on both platforms, with build N and build N+1
  (N+1 adds a no-op test migration on a scratch branch). Record the results in `gates.md`.

**Checkpoint**: every user story is independently functional.

---

## Phase 9: Polish, CI and cut-over

- [X] T076 [P] Write `.github/workflows/desktop.yml`. Jobs on `macos-latest` and `windows-latest`:
  1. `npm ci`;
  2. `npm run test:pglite`;
  3. `npm run test:pg` (macOS only, with the Postgres service);
  4. `desktop:build`, with the size check (SC-002);
  5. Playwright `webkit-desktop` (macOS) or `desktop-windows` (Windows);
  6. `npm run test:desktop`.

  Upload the installers and Playwright traces as artifacts. GPU frame timing is excluded (manual,
  T044).
- [ ] T077 **Cut-over readiness**: re-run T042, T043, T044, T027 and the full native smoke suite
  against the current `v0.2` head, including everything 010 and 012 have landed since. Record the
  results in `gates.md`. If everything is green (SC-004, and coordinator condition (3)), log
  "tauri: ready for cut-over" in STATUS.md. **Do not cut over without the coordinator's and owner's
  go-ahead.** Cut-over removes Postgres for every lane.
- [ ] T078 **Cut-over** (only after the go-ahead in STATUS.md), as one commit:
  - remove `docker-compose.yml`, `db/init/`, the `pg` backend branch in `client.ts`, the `pg` and
    `@types/pg` dependencies (keep `pg` only in `scripts/desktop/import.ts`, which needs it as a
    client), `.env.example` storage lines, and the `STORE=pg` test path and `chromium` web
    project;
  - make `npm run dev` run `tauri dev`;
  - remove the web-mode fallbacks that only existed for FR-025.
- [ ] T079 [P] Update `README.md`: the prerequisites become Node, npm and Rust for developers
  only, and the run steps become `npm install` and `npm run dev` (SC-009). Add a "Desktop app"
  section pointing to `docs/desktop-install.md`, and the data and log locations. Update
  `CLAUDE.md`'s feedback paragraph if the export location note needs it, without changing the
  workflow.
- [ ] T080 Run `npm run lint && npm run typecheck && npm run test:pglite && npm run test:desktop`
  and quickstart V1–V12 one final time. Record it in `gates.md`, then log completion in STATUS.md.

---

## As-built notes (2026-10-07)

- T033, T070 and T074's tests live in `tests/store/` (a vitest project with no shared setup), since
  each opens its own on-disk PGlite folder: `f11-first-launch`, `f11-upgrade`, `f11-snapshots`.
- T056: the new keys are on `GET/PUT /api/settings/app` (see contracts/http-additions.md).
- T061: the composer and function menus (`src/canvas/*`, v0.2-owned) already keep the text and show
  the server's message, which now says what to fix. Linking it to `/settings#provider` is handed to v0.2.
- T072: newer-data is detected from `store-schema.json` beside the store, before opening it, because
  even a read-only PGlite open rewrites its control files; the in-store check stays as a fallback.
- T073: Tauri's own NSIS uninstaller already has an unchecked "Delete the application data" box
  that removes `%APPDATA%\\app.farabi` and `%LOCALAPPDATA%\\app.farabi` (skipped on updates), so no
  hook file was needed. To be confirmed on Windows in T075.
- T039: `webkit-desktop` runs the packaged standalone server against the Postgres test database
  (the e2e resets go through Postgres); the PGlite store has its own parity gate (G3). The
  `desktop-windows` project is still to do, with T043 on a Windows machine.
- T023: `'unsafe-eval'` stays until v0.2 adds `import "pixi.js/unsafe-eval"` to the canvas.
- T076: Postgres and e2e jobs run on Ubuntu (macOS/Windows runners have no service containers);
  the WebdriverIO smoke step is left out until T032/T040/T071 exist.
- T059: removing the key is `PUT { value: null }` (Article II guard: no DELETE handlers).

## Dependencies and execution order

### Phases

- **Setup (T001–T009)**: T001 goes first, since everything depends on the rebased contracts.
  T003–T006 can then run in parallel. T007, then T008, then T009.
- **Foundational (T010–T031)** blocks every story.
  - Bridge and session (T010–T015) and the Rust shell (T016–T020) come before G1 (T021–T023).
  - The store tasks (T024–T029) can run alongside the shell work. G3 (T027) needs T025 and T026.
    G2 (T030) needs T028 and T029.
  - T031 can run any time after T001.
- **US1 (T032–T038)** needs Phase 2. It is the MVP.
- **US2 (T039–T044)** needs Phase 2. T042 and T043 need US1's packaging (T035).
- **US3 (T045–T051)** needs Phase 2. T049 needs T068 (target resolution) for the closed-store
  path, and T050 needs T057 (folder picker).
- **US4 (T052–T063)** needs Phase 2. T034 (US1) is finished properly by T055.
- **US5 (T064–T069)** needs T055 (the config resolver, for `feedback_export_dir`).
- **US6 (T070–T075)** needs T029. T074 is required (coordinator).
- **Polish (T076–T080)**: T076 any time after US1. T077 needs all the stories. T078 needs the
  go-ahead logged at T077.

### Cross-lane dependencies

- T001 needs v0.2's `d0ac962` (done).
- T046 (0012) merges after drill's 0011 (coordinator's merge order).
- T042, T043 and T077 may hand WebKit and canvas fixes to the v0.2 lane.
- T078 needs the coordinator and the owner.

## Parallel examples

### Foundational: shell and store side by side

```text
Developer A: T010 → T011 → T013 → T014 → T015 → T016 → T018 → T019 → T020 → T021
Developer B: T024 → T025 → T026 → T027 (G3) → T028 → T029 → T030 (G2)
```

### US4 tests together

```text
Task: "T052 tests/integration/f11-settings.test.ts"
Task: "T053 tests/integration/f11-provider-ready.test.ts"
Task: "T054 tests/unit/f11-claude-code-discovery.test.ts"
```

### US3 and US4 in parallel after Phase 2

```text
Developer A: T045 → T046 → T047 → T048 → T050 → T051   (import)
Developer B: T052–T054 → T055 → T056 → T059 → T060 → T061 → T062   (settings and providers)
```

## Implementation strategy

### MVP first

1. Phase 1, then Phase 2 with **gates G1, G2 and G3**. Stop and report the numbers in `gates.md`
   and STATUS.md.
2. Phase 3 (US1): an installable app that works with the fake provider on both platforms. Demo it.
3. Phases 4 and 5 (US2, US3): parity on both engines, and the owner's data imported. This is the
   full P1 product.

### Incremental delivery after the MVP

US4 (settings, key and Claude Code, which the owner needs for real use), then US5 (feedback loop),
then US6 (native polish and upgrades), then Polish. Cut-over (T078) comes last, and only on the
go-ahead.

### Notes

- Never edit `feedback/FEEDBACK.md`, attachment files or `feedback_*` rows by hand (CLAUDE.md).
- Commit after each task or logical group, on `011-tauri-desktop-app` only. Only the coordinator
  merges into `v0.2`.
- Check each task against the Constitution. In particular, the import never merges (Article II),
  and provenance values pass through unchanged (Article I).
