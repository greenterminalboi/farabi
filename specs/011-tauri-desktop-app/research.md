# Research: Farabi as a Native Desktop App (Feature 011)

Every open question from the plan's Technical Context is settled here. Each section gives the
decision, why it was chosen, and what else was considered. Three of the decisions (R2, R4, R6)
depend on behavior that can only be confirmed by running code. Each of those names a **gate**: an
early spike that has to pass before the tasks that depend on it go ahead (see plan.md, "Gates").

Facts about the current app that drive these choices (checked in the repo on 2026-10-07):

- It is a Next.js 16 app with 28 route handlers under `src/app/api/`. All server logic is
  TypeScript in `src/server/`: the AI providers, the reply runner in `answers/generation.ts`, the
  graph, feedback export and settings.
- Storage is Postgres 17 through Kysely and `pg` (`src/server/db/client.ts`), with 10 migrations.
  The migrations use plpgsql triggers and functions (11 each), `jsonb`, `gen_random_uuid()` and
  `pg_advisory_xact_lock` (3 call sites). `CREATE EXTENSION vector` runs in `0001_initial`, but no
  column uses it.
- Replies stream in the background, apart from any HTTP request. Transactions are short: the
  reply starts after commit and checkpoints about once a second.
- The `claude-code` provider spawns `claude -p` through `node:child_process`
  (`src/server/ai/claudeCode.ts`).
- Configuration is read from `AI_PROVIDER`, `CLAUDE_MODEL`, `CLAUDE_CODE_BIN`,
  `CLAUDE_CODE_MODEL`, `CLAUDE_CODE_TIMEOUT_MS`, `SUMMARY_TRIGGER`, `FEEDBACK_DIR` and
  `DATABASE_URL`.
- Feature 010 is under way on the same code (11 of about 115 tasks done) and adds more server
  TypeScript.

---

## R1. Where the server-side code runs inside Tauri

**Decision**: Keep the existing Next.js server and run it as a **Tauri sidecar**: a Node runtime
that ships inside the app bundle, started and stopped by the Tauri (Rust) shell. The Tauri window
loads the UI from that server. Rust does only what a native shell must do:

- start, supervise and stop the server;
- one window at a time, and remembering window size and position;
- the OS credential store, native dialogs, and revealing the data folder;
- passing messages to the server over a private stdio channel (R5).

"Tauri for everything" in practice means: Tauri is the only app the user installs and runs, and
it owns the window, the process and every OS integration. The application logic stays in
TypeScript.

**Rationale**:

- **Feature 010 runs in parallel (FR-024)**. Its remaining ~100 tasks add TypeScript to
  `src/server/` and `src/app/api/`. If the server stays TypeScript, everything 010 lands runs
  unchanged in both the web app and the desktop app. A Rust rewrite would chase a moving target
  and duplicate every 010 task.
- **FR-002 is still met**. The Node runtime is bundled privately inside the app. The user never
  installs, sees or updates it.
- There are no native Node modules (`pg` is pure JS, and R2 picks a WASM database), so one
  JavaScript bundle runs on both platforms. Only the Node binary differs per platform.
- Streaming replies, Stop, `child_process` for Claude Code, and filesystem writes for feedback
  export all keep working with no change.

**Alternatives considered**:

- **Rewrite the server in Rust as Tauri commands, with a static UI export**. This is the purist
  version of "Tauri for everything". Rejected: it is a full rewrite of `src/server/` with no
  official Anthropic Rust SDK, and it would double the work of every 010 task. It could still be
  done later, one module at a time behind the same HTTP contract, if dropping Node is ever worth it.
- **Run the server logic inside the webview** (a static export, the database in the browser, and
  Anthropic called directly from the page). Rejected:
  - the API key would sit in page memory;
  - WKWebView's storage durability is weaker than a file the app controls;
  - spawning Claude Code would need Tauri's shell plugin, which splits the provider code in two.
- **Electron**. Rejected by the owner. It would also have bundled Node, but brings a ~150 MB
  Chromium.
- **Bun-compiled single binary**. Rejected for now: Next.js on Bun is less proven than on Node.
  The installer saving (~20 MB) is not needed to meet SC-002.

---

## R2. Local storage

**Decision**: **PGlite** (`@electric-sql/pglite` 0.5.x, which is PostgreSQL 18 in single-user
mode, compiled to WASM). It runs inside the server process and persists to a data directory on
disk through its Node filesystem backend. The `vector` extension
(`@electric-sql/pglite-pgvector`, pinned to the same PGlite version) is loaded so migration 0001's
`CREATE EXTENSION IF NOT EXISTS vector` runs unchanged. This is the coordinator's condition (1),
logged 2026-10-07 12:15.

Kysely 0.29's **built-in `PGliteDialect`** is used. Its adapter reports one connection, so
Kysely's own `ConnectionMutex` serializes queries, and transactions map onto PGlite's exclusive
`transaction()`. There is no hand-written dialect. Coordination research
(`farabi-coord/research/2026-10-07-pglite.md`) confirmed this in `node_modules/kysely`.

Both backends stay available until cut-over:

- `DATABASE_URL` set: Postgres through `pg`, unchanged;
- `FARABI_DATA_DIR` set: PGlite.

The switch in `client.ts` is a backend selection only, landed after v0.2's 0010 commit (condition
(2)).

**Rationale**:

- It is real Postgres. Triggers, plpgsql, `jsonb`, `gen_random_uuid()`, advisory locks (harmless
  with one connection) and every migration run as they are, so Articles I and VI stay enforced in
  the database the same way on both backends.
- It is WASM. There are no per-platform native binaries, and it adds about 9 MB compressed.
- Vitest can use in-memory PGlite, so `npm test` no longer needs Docker.

**Known risks** (from the coordination research, `farabi-coord/research/2026-10-07-pglite.md`):

1. **No fsync.** PGlite starts Postgres with `-F`, and Emscripten NODEFS has no `fsync`. A commit
   reaches the OS page cache, not the disk. A killed *process* should lose nothing, because the
   OS still flushes the cache. A *power loss or OS crash* can lose recent commits or corrupt the
   cluster (issue #327 shows a related PANIC after an unclean exit). The spec's edge case "the
   machine loses power" is therefore at risk.
2. **Two processes on one data dir corrupt it** (issue #1106). This is why the store lock
   (data-model.md §1) is mandatory, and why the CLI never opens a live store (R9). `next dev` hot
   reload must reuse the instance cached on `globalThis`, never open a second one.
3. **Requests are serialized.** A transaction held across a slow await blocks every other request.
   Existing transactions are short (replies stream after commit). Any new transaction that awaits
   an AI call is a bug.

**Gate G2** (run before storage tasks) has three parts:

- **G2a – process kill**: a harness writes continuously (answers streaming, feedback, settings)
  and `SIGKILL`s the server 50 times. After each kill the store must open, pass consistency
  queries, and have lost no committed row (SC-007).
- **G2b – fsync**: count `fsync`/`F_FULLFSYNC` syscalls during commits (`dtruss` on macOS,
  Process Monitor on Windows), and check whether PGlite's start params can drop `-F`. If commits
  reach the disk, the power-loss edge case holds.
- **G2c – power loss**: run G2a's writer in a macOS VM and a Windows VM and hard-reset the VM
  10 times.

**If G2a fails**: switch to embedded native Postgres (below).

**If G2a passes but G2b or G2c fails**: take this to the owner through the coordinator. There are
two options:

- (a) switch to embedded native Postgres, which is real fsync and the safest;
- (b) keep PGlite, and narrow the power-loss edge case to "the store opens, from the last
  automatic snapshot if needed". This adds a `dumpDataDir()` snapshot every 10 minutes and on
  quit, and loses at most the last 10 minutes on a power cut.

The plan does not choose for the owner.

**Fallback – embedded native Postgres**: the platform `postgres` binaries, started on a Unix
socket or named pipe inside the data folder, with fsync on. The same SQL runs, and pgvector must
be bundled too (coordinator condition (1)). It costs about 30 MB more per platform plus
per-platform binaries. Only the backend switch in `client.ts` and the packaging step change.

**Alternatives considered**:

- **SQLite (better-sqlite3 or the Rust side)**. Rejected: it would mean rewriting 10 migrations,
  11 trigger functions and every Postgres-specific query, while 010 keeps adding more. It also
  needs a native Node module per platform.
- **Embedded native Postgres from the start**. This stays as the G2 fallback. It is not first
  choice because of its size, the per-platform binaries and the need to bundle pgvector.
- **`kysely-pglite` (third party)** or a hand-written dialect. Not needed: Kysely ships
  `PGliteDialect`.
- **Postgres in the webview (PGlite with IndexedDB or OPFS)**. Rejected with R1's in-webview
  option.

---

## R3. Bundling the server

**Decision**:

- Build with `output: "standalone"` in `next.config.ts`. This is already documented for Next 16
  (`node_modules/next/dist/docs/01-app/01-getting-started/17-deploying.md`).
- Copy `.next/static` and `public/` into the standalone folder, and ship that folder as a Tauri
  **resource**.
- Download the official **Node 24 LTS** binary for each target at build time
  (`scripts/desktop/fetch-node.ts`, pinned version and checksum). Ship it as a Tauri
  **`externalBin` sidecar** named with the target triple (`node-aarch64-apple-darwin`,
  `node-x86_64-apple-darwin`, `node-x86_64-pc-windows-msvc.exe`).
- Rust starts `node <resources>/server/server.js` with `HOSTNAME=127.0.0.1` and a `PORT` it chose
  (R4).
- macOS ships separate arm64 and x64 builds, not a universal build, so the Node binary is not
  carried twice.

**Rationale**: Standalone output is the supported way to run a Next server outside the repo, and
traces only the dependencies that are needed. Migrations load from the static import list
`src/server/db/migrationList.ts` (a v0.2 contract change, logged 2026-10-07), so they are traced
into the bundle with no runtime directory scan. Sizes: Node is ~40 MB compressed, the standalone
server plus PGlite ~25 MB, and the Tauri shell ~5 MB. That totals about 70 MB, inside SC-002's
100 MB, and the size is measured in CI.

**Alternatives considered**:

- **Node single-executable application (SEA)**. Rejected: SEA embeds one script, not a traced
  `node_modules` tree with WASM assets.
- **A custom Next server** (`custom-server.md`), so it can listen on port 0 and report the port.
  Not needed: R4 has Rust pick the port. It also gives up standalone tracing.

---

## R4. Launch, the private session and "not reachable by other programs" (FR-003)

**Decision**: The server listens only on `127.0.0.1`, on a port Rust picks at launch (bind to
`127.0.0.1:0`, read the port, release it). Every request must carry a **per-launch session
secret**:

1. Rust generates 32 random bytes and sends them to the server on the stdio channel (R5), never in
   argv or the environment, which other same-user processes can read.
2. The window's first navigation is `http://127.0.0.1:<port>/__farabi/session?t=<secret>`. The
   server sets an `HttpOnly; SameSite=Strict; Path=/` cookie and redirects to `/`.
3. `src/proxy.ts` (Next 16's renamed middleware) rejects any request whose cookie does not match,
   or whose `Host` is not exactly `127.0.0.1:<port>`. The `Host` check defends against DNS
   rebinding. The CLI (R9) uses an `Authorization: Bearer` header with the same secret, read from
   a 0600 runtime file.
4. The checks are active only when the server runs under the desktop shell. They are off in the
   web app before cut-over.

**Rationale**:

- Tauri v2's custom URI scheme handlers return a whole response body. They cannot stream, so
  serving the UI over `farabi://` would break live replies.
- Loopback plus a secret is the standard pattern for a Tauri sidecar server. Other programs can
  open a TCP connection, but they get `401` and no data. That meets FR-003's intent: the interface
  and data are not exposed. Machines on the network cannot reach a loopback-only listener at all.

**Gate G1 (shared with R6)**: the spike shows the full launch sequence (port, secret, cookie,
proxy) with a streaming reply arriving token by token in WKWebView and WebView2.

**Alternatives considered**:

- **Unix domain socket or named pipe, proxied through a `farabi://` scheme**. Rejected: no
  response streaming.
- **The `tauri-plugin-localhost` plugin**. Rejected: it serves static assets, not an app server.
- **A bearer token in the URL of every request**. Rejected: it leaks into logs and history. A
  cookie is sent automatically and is invisible to page script.

---

## R5. Rust ↔ server channel ("host bridge")

**Decision**: A line-delimited JSON channel over the sidecar's **stdin and stdout**, with request
and response ids. It is defined in `contracts/host-bridge.md`.

- The server side lives in `src/server/host/bridge.ts` and starts from `instrumentation.ts`. It
  exists only when `FARABI_HOST=tauri`. Otherwise every call falls back to the web-app behavior,
  so the web app keeps working (FR-025).
- **Rust → server**: `hello` (the session secret, data dir, app version, platform), `shutdown`.
- **Server → Rust**: `ready`, and requests the server cannot fulfil itself:
  - `credentials.get`, `credentials.set`, `credentials.delete` (FR-013);
  - `dialog.pickFolder` (choosing the feedback folder);
  - `shell.reveal` (FR-019);
  - `window.focus`.
- Server logs go to stderr, and Rust writes them to a rotating log file in the app's log folder
  with the API key redacted (SC-008).

**Rationale**: The UI keeps talking only HTTP to its own server, exactly as today. No page code
calls Tauri APIs, so there is one UI code path for the web app and the desktop app. That means
the webview needs no Tauri IPC permissions for a remote origin. Stdio is private to the parent and
child processes, unlike a socket.

**Alternatives considered**:

- **The UI calls Tauri `invoke` directly**. Rejected: the UI would need `window.__TAURI__`
  branches, and IPC would have to be enabled for an `http://127.0.0.1` origin.
- **The server reads the keychain itself (`keytar`)**. Rejected: it is a native module and has
  been archived.

---

## R6. Engine parity: WKWebView on macOS and WebView2 on Windows

**Decision**:

- **Windows**: WebView2 is Chromium, so the current target holds.
- **macOS**: WKWebView is WebKit. PixiJS v8 runs on WebGL2 there, and the real-DOM text layer
  (010 FR-030–FR-034) depends on WebKit's selection behavior.

From now on, a **Playwright `webkit` project** runs the e2e suite next to Chromium, so 010's
remaining tasks are checked on WebKit as they land (FR-024).

**Gate G1**: run 010's M0 scale proof (`npm run seed:large`, 5,000 elements) inside the Tauri
window on the owner's Mac. Measure p95 frame time while panning with the in-page frame probe 010
already uses. The gate passes at ≤ 16.7 ms (SC-005).

If it fails, the plan is revisited with the owner before more desktop work: profile and fix the
WebKit hot path first. As a last resort, use a Chromium-based runtime under Tauri, which would
cost SC-002.

**Rationale**: This is the largest technical risk of choosing Tauri over Electron. It is measured
first, while it is still cheap to change course.

**Alternatives considered**: assume parity and find out at cut-over. Rejected: that is too late
to change course.

---

## R7. Testing the desktop app (SC-004)

**Decision**: Three layers.

1. **Unit and integration (Vitest)**: run against **both** store backends. `pg` stays until
   cut-over, and PGlite runs in-memory. A `STORE=pglite|pg` matrix in `vitest.config.ts` proves
   the two behave the same.
2. **E2E (Playwright)**, one suite, three targets:
   - `chromium` against `next start` (the web app, until cut-over);
   - `webkit` against the **packaged standalone server on PGlite**, for macOS engine parity;
   - `desktop-windows`: the built Tauri app on Windows, attached with `connectOverCDP` to WebView2
     (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`).
3. **Native smoke (WebdriverIO with the embedded WebDriver plugin for Tauri)**, on macOS and
   Windows. It covers the things only the real shell does:
   - single instance and window state;
   - credential round-trip, data-folder creation and reveal;
   - one full streamed reply;
   - restart persistence.

   This is needed because Apple ships no WebDriver for WKWebView, so Playwright cannot drive the
   macOS app itself.

At cut-over, SC-004 counts layers 2 and 3 on both operating systems.

**CI**: GitHub Actions `macos-latest` and `windows-latest` (the repo is on GitHub) build the
installers, report their sizes (SC-002), and run layers 1–3. Hosted runners have no real GPU, so
SC-005 frame timing is measured on the reference hardware (quickstart.md, V5), not in CI.

**Alternatives considered**:

- **Only WebdriverIO**. Rejected: it would mean rewriting the existing Playwright suites.
- **`tauri-driver`**. Rejected: Linux and Windows only.

---

## R8. Settings, the API key and Claude Code discovery

**Decision**:

- **Settings**: the env-only settings become keys in the existing append-only `settings` history
  (Feature 6, table `setting_changes`), so the newest row is in effect and changes are kept. The
  new keys are `ai_provider`, `default_model`, `summary_trigger`, `feedback_export_dir` and
  `claude_code_path`. A migration widens the key `CHECK` (data-model.md §3).
  Precedence is: a stored row, then an environment variable (web app and tests only), then the
  current default. Defaults are unchanged: `fake` until a key is saved (spec, Assumptions), and
  `reply` for the summary trigger.
- **API key**: the Rust `keyring` crate stores it under service `app.farabi`, account
  `anthropic-api-key`. That is the macOS Keychain and the Windows Credential Manager. The server
  asks for it through `credentials.get` when it builds the Anthropic client, keeps it in memory
  only, and redacts it in logs. It is never written to the store or a file (FR-013, SC-008).
- **Claude Code discovery** (FR-012a): apps started from Finder or the Dock do not inherit the
  shell `PATH`. Candidates are tried in this order:
  1. a user-set `claude_code_path`;
  2. `CLAUDE_CODE_BIN`;
  3. on macOS: the login shell's answer (`$SHELL -ilc 'command -v claude'`, 3 s timeout),
     `~/.claude/local/claude`, `~/.local/bin/claude`, `/opt/homebrew/bin/claude`,
     `/usr/local/bin/claude`;
  4. on Windows: `%USERPROFILE%\.local\bin\claude.exe`, `%APPDATA%\npm\claude.cmd`, then `where
     claude`.

  `.cmd` shims are run through `cmd.exe /d /s /c` with arguments quoted. The existing safeguards
  are kept as they are: an empty temporary working directory, `childEnv()` stripping
  `ANTHROPIC_*` and `CLAUDE_CODE_*`, and tools disabled.

  The **status probe** runs `claude --version` (found or not), and reads the first run's
  stream-json `result` for authentication errors (signed out). The Settings page shows one of
  *Found · signed in*, *Found · signed out* or *Not found*, and offers the API provider.

**Alternatives considered**:

- **A separate settings file**. Rejected: it would be a second store with its own durability
  story. The history table already exists.
- **Bundling Claude Code**. Rejected: it is the user's own subscription tool, and the spec makes
  it optional.

---

## R9. Command-line scripts against the desktop store

**Decision**: The PGlite store is single-process, so scripts (`feedback:addressed`, `seed:large`,
`v1:convert`, `v1:verify`, `db:migrate`) cannot open it while the app runs. `scripts/env.ts`
resolves the target in this order:

1. `DATABASE_URL`: Postgres, as today, until cut-over.
2. Otherwise, the desktop data dir: the platform default (R10) or `FARABI_DATA_DIR`.
   - If `runtime.json` is there and its process is alive, the script calls the running app's HTTP
     API with the bearer secret. `feedback:addressed` gets a dedicated
     `POST /api/feedback/{id}/addressed` route with the same rules as today (open → addressed
     only).
   - Otherwise it takes the store's lock file and opens PGlite directly.
   - The scripts that cannot run safely against a live app (`seed:large`, `v1:*`, `db:migrate`)
     refuse with "quit Farabi first" instead of using HTTP.

The `CLAUDE.md` feedback workflow and its command stay the same (FR-020).

**Alternatives considered**: always require quitting the app. Rejected: marking feedback
addressed while the app is open is the everyday case.

---

## R10. Data location, upgrades, backups and the newer-version guard

**Decision**:

- **Data dir**: Tauri's `app_data_dir()` for identifier `app.farabi`:
  - macOS: `~/Library/Application Support/app.farabi/`;
  - Windows: `%APPDATA%\app.farabi\`.

  It holds `store/` (PGlite), `backups/`, `feedback/attachments/` (the canonical screenshots;
  the export folder gets a mirror), `runtime.json` and `store.lock`. Logs go to the OS log dir.
- **Upgrades (FR-018)**: at start, before opening the store for use, the server compares the
  store's executed migrations with those the app knows.
  - If any are pending, it copies `store/` to `backups/<UTC timestamp>-pre-<migration>/` (the
    store is closed, so a plain directory copy is consistent), checks the copy opens, then runs
    the migrations. Kysely runs them in one transaction on Postgres semantics (010 research R3).
  - If the store contains migrations the app doesn't know, it refuses to start and the window
    shows a "data from a newer Farabi" screen. Nothing is written.
  - The 5 newest automatic backups are kept.
- **Coordination with 010 (R3 there)**: 010's pre-`0010` backup uses `docker compose exec …
  pg_dump`. Under PGlite the same rule applies through this backup path. `scripts/migrate.ts`
  picks the method by backend.
- **Uninstall (FR-023)**: neither the macOS app bundle nor the Windows NSIS uninstaller removes
  the data dir. The NSIS uninstaller offers an unchecked "Also delete my Farabi data" box.

**Alternatives considered**: PGlite `dumpDataDir()` tarballs for backups. This is kept for the
manual export later. A directory copy is simpler and faster while the store is closed.

---

## R11. Importing the web-app database (FR-017)

**Decision**: An **Import from the web app** action in Settings (and `npm run desktop:import`)
takes a Postgres connection string, `postgres://farabi:farabi@127.0.0.1:5432/farabi` by default.
It requires:

1. **An empty destination**: no projects or feedback yet. Importing never merges into existing
   data (Constitution Article II: no reconciliation of two bodies of data).
2. **The same schema level**: the source's `kysely_migration` rows equal the app's. If the source
   is behind, the user is told to run `npm run db:migrate` on it first. If it is ahead, the app is
   too old.

It then copies every table in foreign-key order inside **one PGlite transaction**:

- with `session_replication_role = replica`, so write-once and provenance triggers do not refire
  on rows that already passed them in the source;
- keeping ids, timestamps and provenance values unchanged;
- then resetting sequences, and copying attachment files into `feedback/attachments/`.

Afterwards it compares row counts and a per-table checksum (an ordered `md5` of each row's text)
between source and destination (SC-006), and writes an `import_runs` row. Any failure rolls back
everything. A repeat import is refused with "already imported on <date>", detected from the
destination not being empty and the recorded source `system_identifier`.

**Alternatives considered**:

- **`pg_dump` and restore**. Rejected: it needs Postgres client tools, which is not zero-setup
  even for the owner's one-time move.
- **Merging into a non-empty store**. Rejected under Article II.

---

## R12. Window, single instance and distribution

**Decision**:

- Plugins:
  - `tauri-plugin-single-instance`: a second launch focuses the existing window (FR-005);
  - `tauri-plugin-window-state`: size, position and maximized state, clamped to a visible monitor
    (FR-006);
  - `tauri-plugin-dialog`;
  - `tauri-plugin-opener`, to reveal the data folder.
- **Bundles**: macOS `.dmg` (arm64 and x64), and a Windows NSIS `.exe` (x64) with the WebView2
  bootstrapper in `downloadBootstrapper` mode. WebView2 is preinstalled on Windows 10 21H2 and
  later, and on Windows 11.
- **Unsigned**, per FR-021. `docs/desktop-install.md` documents the first launch: right-click →
  Open on macOS, or `xattr -dr com.apple.quarantine /Applications/Farabi.app`. On Windows,
  SmartScreen → More info → Run anyway.
- **No updater plugin**. A newer installer over the old one keeps data, because the data is not
  inside the bundle (FR-022).

**Alternatives considered**: an MSI on Windows. NSIS gives the uninstall checkbox and per-user
install without admin rights.

---

## R13. Development workflow and cut-over (FR-024, FR-025, SC-009)

**Decision**:

- **Until cut-over, both apps run from one codebase**:
  - `npm run dev` is the web app, as today;
  - `npm run desktop:dev` runs `tauri dev`, where Rust spawns `next dev` with the system Node,
    the host bridge and `FARABI_DATA_DIR=<repo>/.farabi-dev`.

  The dev and production launches use the same handshake.
- **Cut-over** happens when SC-004 passes on both operating systems. It is one commit that:
  - removes `docker-compose.yml`, `db/init/`, the `pg` dialect and `.env` handling for storage;
  - makes `npm run dev` start the desktop app;
  - updates `README.md`.

  The development steps then become `npm install` and `npm run dev` (SC-009). Rust and the Tauri
  CLI are developer prerequisites, not user ones (spec, Assumptions).
