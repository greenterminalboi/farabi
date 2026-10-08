// Runs in the browser before the app becomes interactive (Next's instrumentation-client file).
// Zod 4 probes for `new Function` the first time it parses an object, to pick its JIT fast path.
// Under the desktop CSP without 'unsafe-eval' that probe is blocked and reported as a violation,
// so the browser bundle runs Zod jitless (the same results, no eval). Pixi's no-eval paths are
// installed in src/canvas/renderer/CanvasRenderer.ts.
import { z } from "zod";

z.config({ jitless: true });
