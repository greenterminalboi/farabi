# Gate results: Feature 011

## G3: backend parity (T027), 2026-10-07, macOS arm64

| Run | Files | Tests |
|-----|-------|-------|
| `npm run test:pg` (Postgres, `farabi_test_tauri`) | 39 passed | 263 passed |
| `npm run test:pglite` (in-memory PGlite 0.5.8) | 39 passed | 262 passed, 1 skipped |

**Pass.** Differences found and fixed (none in SQL or in the tests' assertions):

1. **Constructor**: `new PGlite(undefined, opts)` dropped the options, so pgvector didn't load.
   Fixed in `client.ts` by passing `dataDir` inside the options.
2. **int8**: PGlite parsed `int8` to a number, while `pg` gives a string. A parser was added in
   `client.ts`.
3. **Clock resolution**: PGlite's Postgres reads wall-clock time through Emscripten's
   `Date.now()`, which is milliseconds. History ordered by
   `created_at DEFAULT clock_timestamp()` tied within a millisecond and fell back to random uuid
   order (feedback tags and attachments came back shuffled). This matters for Article VI.
   `scripts/desktop/patch-pglite.ts` (postinstall) swaps the source for
   `performance.timeOrigin + performance.now()`, giving microseconds like native Postgres. It is
   idempotent and fails loudly if PGlite's code changes.
4. **Skipped on PGlite only**: `f3-us3-claude-code` "the real script exits 0, 2, 3 and 1". It
   spawns the CLI as a second process against the test store, which an in-process store can't
   allow (#1106). It is covered against the live app in US5 (T064–T069).

Not store-related: `f10-layout` "lays out a 5,000-element column quickly" (< 1000 ms) failed once
at 1575 ms while two suites ran at once on the same machine. It passed when re-run alone.

## G2: store durability (T028, T030), 2026-10-07, macOS arm64

- **G2a passed: 50/50.** `npm run desktop:durability -- --kills 50`. Each round SIGKILLed a writer
  1.5–4 s into continuous transactions (project plus setting insert, then an in-place update). The
  side log recorded 25,541 committed ids, and **none was missing**. Every public btree index passed
  `bt_index_check` (amcheck) after every kill. `present` is sometimes one more than `committed`,
  when the kill landed between COMMIT and the side-log write. That is expected and safe.
- **G2b: fails by construction (source-verified, not traced).** PGlite starts Postgres with `-F`,
  and Emscripten NODEFS has no `fsync` (`farabi-coord/research/2026-10-07-pglite.md` §4). Tracing
  with `dtruss` needs sudo with SIP relaxed, so the trace wasn't run. Commits reach the OS page
  cache, which survives a killed process (G2a) but not a power cut or kernel panic.
- **G2c: not run.** It needs macOS and Windows VMs that can be hard-reset; this is for the owner.
- **Consequence**: the coordinator already made scheduled `dumpDataDir()` snapshots mandatory
  (T074), which is R2 option (b). The spec edge case "machine loses power" holds up to the last
  snapshot. The owner can still choose option (a), embedded native Postgres, if that's not
  enough.

## G1: shell spike (T021–T023), in progress

**Server side (headless fake shell against `next dev`, macOS)**: passed.

- The `hello` → `ready` handshake took 1.6–3.0 s, including creating and migrating a new PGlite
  store.
- No session: `401`. Wrong `Host`: `421`. Foreign `Origin` on PUT: `403`. Bad secret on
  `/__farabi/session`: `401`.
- Right secret: `303` to `/` with `farabi_session; HttpOnly; SameSite=strict`. Cookie or bearer:
  `200`.
- `shutdown`: exit 0, with `runtime.json` and `store.lock` removed. Killing the shell process
  (SIGTERM) also left no orphan server, because the server shuts down when its stdin closes.

**Real Tauri window (WKWebView, `npm run desktop:dev` with `scripts/desktop/g1-probe.js`)**:
partial.

- The window loaded the app through the session. In-page SSE streamed token by token: 5 deltas
  over 300 ms at a 60 ms chunk delay, after the fake "slow" mode's ~4.4 s first-byte delay.
- The run then stalled. The page's timers stopped entirely, including the probe's own 20 s
  timeout. WebKit suspends pages in windows that aren't visible (App Nap and occlusion), and the
  window had opened behind other windows. **The probe needs the window in front and visible**,
  so it needs the owner at the machine.

**WebKit engine, via Playwright WebKit 26.6 against the production server** (`npm run
test:e2e:webkit`): **43/44 passed.**

- 010's scale test: the 5,000-element canvas opened in **541 ms**. Pan p95 was **15 ms** far and
  **15 ms** near (budget 16.7 ms), zoom p95 **15 ms** (budget 20 ms), and the minimap 16 ms.
- The one failure was a real WebKit parity bug: `canvas.toBlob("image/webp")` isn't supported, so
  feedback thumbnails were dropped and full images were served. **Fixed**: JPEG thumbnails as the
  fallback (`src/lib/thumbnail.ts`, `src/server/feedback/attachments.ts`). The test now passes on
  both engines.

**Still to do for G1**: the frames probe in the real WKWebView window with it in front (owner),
then the same on Windows (T022), and the CSP tuning on the production build (T023).

## US1 packaging (T035, T036, T038 macOS half), 2026-10-07, macOS arm64 (M-series)

| Check | Result |
|---|---|
| Installer | `Farabi_0.2.0_aarch64.dmg`, **61.5 MB** (SC-002 limit 100 MB) |
| Launch with no system Node (`env -i HOME=…`, no PATH) | Starts; store created, every migration run, `runtime.json` written |
| First launch on an empty data folder (initdb + migrations) | **3.72 s** to ready |
| Warm launch | **0.56 s**, 0.57 s to ready |
| Quit (SIGTERM to the shell) | 0.40–0.49 s; `runtime.json` and `store.lock` removed, final snapshot taken, no orphan `node` |
| Without the session cookie or bearer | 401 |
| Claude Code discovery with no PATH | Found `/opt/homebrew/bin/claude` 2.1.293 through the login shell |

Notes:
- Running the binary through a symlinked path (for example a DMG mounted under `/var/folders`,
  which is `/private/var/folders`) fails with "unknown path": Tauri refuses a starting binary whose
  path goes through a symlink. Normal mounts (`/Volumes/…`) and `/Applications` are unaffected.
  Fatal start-up errors are now also printed to stderr and the server log.
- A SIGTERM quit leaves `/tmp/app_farabi_si.sock` behind, but the next launch starts normally
  (checked). An apparent hang during testing was single-instance working as designed: an earlier
  instance stuck on its error page was still running, and the new launch handed over to it.
- Still for the owner: a clean macOS user account, and the Windows installer (T038).

## US2 parity on WebKit with the packaged server (T039, T042, T023), 2026-10-07, macOS arm64

`npm run test:e2e:desktop`: the packaged standalone server (prepared like the app bundle, test
hooks on), the desktop content security policy enforced (`FARABI_CSP=1`), WebKit.

| Check | Result |
|---|---|
| e2e suite (44) + `f11-csp` (policy blocks nothing on canvas, streaming, Settings, Definitions, Feedback) | **45/45** |
| 5,000-element canvas open | 533 ms |
| Pan far / pan near / zoom p95 | 16 / 16 / 16 ms (budgets 16.7 / 16.7 / 20) |
| Minimap | 12 ms |

CSP as shipped: `default-src 'self'; img-src 'self' data: blob:; font-src 'self' data:;
style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; worker-src 'self' blob:;
connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`. Without
`'unsafe-eval'`, PixiJS 8 fails ("Current environment does not allow unsafe-eval"). Dropping it
needs `import "pixi.js/unsafe-eval"` in `src/canvas` (v0.2-owned), handed off in STATUS.md.

Bundle hygiene: Turbopack had traced runtime-folder paths as globs over the repo (tests, sources,
the repo's `feedback/FEEDBACK.md`). Fixed; `prepare-server` now fails the build on any stray
top-level file. Clean server: 87 MB unpacked.

## US5 feedback loop (T069, quickstart V9), 2026-10-07, macOS arm64, packaged app

Export folder set to a temp folder (not the repo's `feedback/`, to leave the owner's real file alone).

| Step | Result |
|---|---|
| Set the export folder in the running app | FEEDBACK.md written there at once |
| New item with a screenshot | Item listed in FEEDBACK.md; screenshot mirrored to `<export>/attachments/<id>/` |
| `npm run feedback:addressed -- <id> --data-dir <D>`, app open | "Marked … addressed.", exit 0, via the app (bearer route); FEEDBACK.md shows `addressed` |
| Same again | "…is addressed; only open items…", exit 2 (unchanged CLI contract) |
| App closed: `feedback:export`, `feedback:addressed`, `db:migrate` with `--data-dir` | Open the store directly; exit 0 / 2 / 0 ("Up to date at 0012_desktop") |

Until cut-over, the repo's `.env.example` sets `DATABASE_URL`, so the CLAUDE.md command targets
Postgres unless `--data-dir` is given; after cut-over it finds the installed app's data by default.

## G1 in the real WKWebView (T021), 2026-10-07, macOS arm64, 1280×792 window at 1×

The probe (`scripts/desktop/g1-probe.js`) injected into the real app window by a debug shell, with
the window kept on every Space and on top (WebKit pauses pages it can't see). Data: 5,000-element
seed in `.farabi-dev`.

| Build | Open | Pan far p95 | Pan near p95 | Zoom p95 | Verdict |
|---|---|---|---|---|---|
| **Production server** (`FARABI_SERVER_DIR=.desktop-test/server`, what the app ships) | **820 ms** | **14 ms** | **15 ms** | **14 ms** | **PASS** |
| `next dev` (development React), for comparison | 1,496 ms | 264 ms | 15 ms | 14 ms | dev only |

Streaming (production): token by token; Stop after 3 deltas kept the partial reply
(status `stopped`, 52 chars). **G1 passes on macOS.** Windows (T022) is out of scope for now (owner, 2026-10-07).

## Cut-over (T077, T078), 2026-10-07, macOS arm64

| Check | Result |
|---|---|
| `npm test` (unit, integration on in-memory PGlite, on-disk store tests) | 423 passed, 5 skipped; 1 failure: f10-layout timing (2.06 s vs 1 s under load average ~7; v0.2's test, no layout change here) |
| Import round trip (`IMPORT_SOURCE_URL` scratch Postgres) incl. a source one migration behind, upgraded on the way in | 5/5 |
| `npm run test:e2e`: packaged server in desktop mode, WebKit + Chromium | 115/116; the one failure is WebKit-only in lexicon's TermCard (handed to v0.2, marked test.fail) |
| Installer | `Farabi_0.2.0_aarch64.dmg` 61.4 MB |
| Launch with no system Node | cold 3.79 s, warm 1.06 / 0.84 s, quit ≤ 0.96 s, no orphans |
