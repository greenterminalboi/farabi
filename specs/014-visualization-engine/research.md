# Research: Farabi Visualization Engine

## R1. Rendering technology

**Decision**: SVG, produced from a pure-TypeScript draw list, rendered by React in the player and
serialized to a string for stills. Animation is computed in JS per animation frame (we interpolate
the draw list ourselves), not with CSS transitions or the Web Animations API.

**Rationale**:
- One picture, two outputs: the same draw list gives the on-screen frame and the exported SVG, and
  the SVG string can be produced on the server (FR-012, SC-006). PNG comes from drawing that SVG on a
  2D canvas.
- Scrubbing to any in-between position is trivial when time → picture is a pure function; with CSS
  transitions or WAAPI, seeking a set of independent animations to an exact position and exporting
  that exact frame is awkward.
- Text, accessibility (`<title>`, `<desc>`, `role="img"`), theming via CSS custom properties and
  crisp zoom come for free with SVG. Text in WebGL needs bitmap fonts.
- No eval: plain DOM, no shader compilation (FR-020).
- 200 elements ≈ 600 SVG nodes; React reconciles that well within a 16 ms frame (verified by the
  e2e perf check, SC-002).

**Alternatives considered**:
- PixiJS 8 (already a dependency): fast for thousands of sprites, but needs `pixi.js/unsafe-eval` to
  avoid eval, cannot produce an SVG still, has no server-side path, makes text and accessibility
  harder, and is overkill at ≤ 200 elements.
- Canvas2D: no DOM cost, but no vector export, no server path without a native canvas package, and
  text alternatives must be maintained separately.
- CSS/WAAPI transitions on SVG: less JS, but exact scrubbing and frame export are hard, and a swap
  that crosses cells needs coordinated keyframes anyway.

## R2. Scene format and validation

**Decision**: a JSON scene `version: 1`, validated by a zod schema (structure, bounds) followed by
a simulation pass that applies every step to a working state and reports reference problems
(`steps.3.actions.0.target: no element "arr2"`) as zod issues through `superRefine`. One
`parseScene()` returns all problems with paths.

**Rationale**: references depend on state over time (a stack frame that was popped, a pointer that
was never declared); simulating is the only exact check, and it reuses the same fold the renderer
uses, so "valid" means "renders".

**Alternatives**: JSON Schema + ajv (new dependency; ajv compiles validators with `new Function`,
forbidden by the CSP). Zod 4 itself probes `Function("")` once unless `jitless` is set; the probe
is caught by zod, and the polish branch sets `z.config({ jitless: true })` in the browser.

## R3. Primitive set

**Decision**: 8 element types (box, text, connector, code, array, panel, stack, graph) and 12
actions (highlight, clear, set, swap, compare, pointer, push, pop, show, hide, move, line). Trees and
graphs are one `graph` type with layouts (tree, layered, circle, row, manual). Arguments are boxes
with a `role` joined by connectors with a `relation` (supports, attacks, conflicts, plain).

**Rationale**: covers the three families with the fewest concepts; an AI can produce it reliably;
templates build common scenes from simpler input.

## R4. Animation model

**Decision**: continuous time `t ∈ [0, N]` in steps. Frame `i` is the state after `i` steps.
In-between positions blend draw lists of frames `⌊t⌋` and `⌈t⌉` matched by stable keys: numbers
(x, y, w, h, opacity, line endpoints) interpolate with ease-in-out; strings and paints switch at
half way; items only on one side fade. Array cells are keyed by cell identity, not index, so a swap
animates the cells crossing. Playback spends 55% of a step's duration (default 900 ms) moving and
the rest dwelling. Reduced motion: no movement, the whole duration dwells.

## R5. Theming

**Decision**: draw items carry token names (`text`, `surface`, `accent`, `good`, `bad`, `partial`,
`ai`, `muted`, `border`, `connector`, `accent-soft`). On screen, paints are `var(--viz-token)`, which the
player's CSS module defines as `var(--token, <fallback for the current scheme>)`, so the drawing follows
the theme instantly even where the app lacks a token (e.g. `--good` before the polish branch). For stills, the browser reads the computed custom
properties into a palette (fallback values per scheme), and the SVG gets literal colours.
Fallbacks equal polish's `tokens.ts` values, so it looks right with or without that branch.

## R6. Text measurement

**Decision**: estimate widths (code: 0.6 em per character, monospace; prose: 0.56 em average) and
wrap/ellipsize from that. Deterministic and identical in Node and browsers; slight over-estimation
gives margins rather than overflow.

## R7. Generation

**Decision**: `generateScene()` in `src/server/viz/generate.ts` defines the generation as an
operation object (`vizGenerate`, shaped like a drill operation) and runs it with the drill lane's
generic executor `callOperation` (`src/server/drill/operations/call.ts`): ask, extract JSON,
validate, retry once with the problem stated, else throw. That executor is the only place outside
`src/server/{ai,functions}` the feature 10 constitution guard lets call the provider, so viz reuses
it rather than adding a second caller. Tag `viz_generate`, effort `medium`, `maxTokens` 8000, model
from the request (a known model id) or the default. The output schema forces `origin` to
`ai-suggested` and then runs `parseScene`. The fake responder is built from templates (code →
line-by-line trace; numbers → bubble sort; otherwise two statements → contradiction). The route
calls `providerReady()` first, maps `VizGenerationError` to 503 `viz_unavailable` itself, and
writes nothing.

**Alternatives**: a separate caller in `src/server/viz` (rejected: the constitution guard allows one
executor, and duplicating it adds nothing); a kind function (that's integration, out of scope).

## R8. Export

**Decision**: SVG: `renderSvg(scene, t, { palette })` string → Blob download. PNG: SVG Blob URL →
`Image` → `<canvas>` at 2× → `toBlob("image/png")`. No `foreignObject`, so WebKit doesn't taint the
canvas; CSP already allows `img-src blob: data:`.

## R9. Preview page availability

**Decision**: `/dev/viz` in every build, unlinked (spec clarification). It only reads hand-written
examples and calls the generate route on demand.
