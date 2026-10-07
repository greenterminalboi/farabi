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
