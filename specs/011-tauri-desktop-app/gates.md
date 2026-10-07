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
