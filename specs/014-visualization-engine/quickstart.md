# Quickstart: Farabi Visualization Engine

## Prerequisites

`.env.local` with private databases and `AI_PROVIDER=fake` (never the owner's `farabi` DB).

## Run

```bash
npm run dev            # then open http://127.0.0.1:3000/dev/viz
```

1. Gallery: pick each example (code, algorithm, argument). Press Play, Pause, Next, Previous; drag
   the scrubber. Keyboard on the player: Space, ←, →, Home, End. The caption updates and is
   announced; "Text alternative" lists every step.
2. Export: step to a frame and press "Export SVG" and "Export PNG"; the files show that frame.
3. Paste scene JSON → Render: a valid one plays; an invalid one lists problems with paths.
4. Paste text → Generate: with the fake provider, a deterministic AI-suggested scene plays (code →
   line trace, numbers → bubble sort, two statements → contradiction).
5. Toggle the OS theme: the drawing follows.

## Tests

```bash
npx vitest run tests/unit/f14-*.test.ts
npx vitest run tests/integration/f14-viz-generate.test.ts
E2E_PORT=3140 NEXT_DIST_DIR=.next-viz-test TEST_DATABASE_URL=postgres://farabi:farabi@127.0.0.1:5432/farabi_viz_test \
  npx playwright test tests/e2e/f14-viz.spec.ts      # includes the 200-element frame-time p95
```

Expected: all pass; the perf test logs `viz p95 frame ms` ≤ 20.
