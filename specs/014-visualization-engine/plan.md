# Implementation Plan: Farabi Visualization Engine

**Branch**: `014-visualization` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/014-visualization-engine/spec.md`

## Summary

A standalone engine that turns a versioned, validated scene description (JSON) into animated and
still visualizations. The core is pure TypeScript with no DOM: validate (zod + a reference-checking
simulation), fold the steps into one state per frame, lay each state out into a flat list of keyed
draw items, blend two neighbouring draw lists for in-between positions, and serialize a draw list
either as an SVG string (stills, server-side, tests) or as React SVG elements (the player). Both
serializers share one virtual-node builder, so the screen and the exported image are the same
picture. Generation from text is a server module that asks the configured provider for a scene,
validates it, retries once with the problem, and forces `origin: "ai-suggested"`; one route exposes
it. A dev page shows a gallery and a generator. No new dependency, no storage, no shared-file edits
beyond the coordination log.

## Technical Context

**Language/Version**: TypeScript 6, React 19, Next.js 16 (App Router)

**Primary Dependencies**: zod 4 (already present). No new packages. PixiJS is deliberately not used
(research R1).

**Storage**: none (FR-021). No migration.

**Testing**: vitest (unit + integration projects, fake provider via `registerFakeCompletion`),
Playwright (chromium; webkit opt-in) on port 3140.

**Target Platform**: Chromium and WebKit (Tauri WKWebView, CSP without 'unsafe-eval'); Node for
server-side stills and generation.

**Project Type**: web application (Next.js app, single project).

**Performance Goals**: 200-element scene animates with frame time p95 ≤ 20 ms (SC-002); drawing one
frame of 200 elements in pure TS well under 4 ms.

**Constraints**: no `eval` / `new Function` / string-to-code (FR-020); deterministic layout without
font measurement (fixed character-width estimates), so server and browser output match (SC-006).

**Scale/Scope**: ≤ 200 elements, ≤ 100 steps per scene; source text ≤ 20,000 characters.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Article | Check | Result |
|---|---|---|
| I. User is final authority | Every scene carries `origin` (`user-authored` / `ai-suggested`); generation forces `ai-suggested`; the player and stills show an "AI-suggested" badge. Nothing is persisted, so no confirmed state exists yet; integration must map origin onto the app's three states (ai-suggested / user-confirmed / user-authored). | Pass |
| II. Additive growth | No storage, no merge or deletion semantics. | Pass |
| III. Nothing invented ahead of evidence | The generation prompt confines the AI to depicting the structure in the given text; no verdicts, no claims about the user (FR-017). Tested by a prompt guard. | Pass |
| IV. User-led exploration | Generation only runs on an explicit Generate press; no AI-initiated suggestions. | Pass |
| V. Compression preserves meaning | Truncated labels keep their full text in the text alternative (FR-009, edge cases). | Pass |
| VI. History is data | Not applicable: no personalization. | Pass |

Post-design re-check: unchanged, pass.

## Project Structure

### Documentation (this feature)

```text
specs/014-visualization-engine/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── scene-v1.md        # the scene description format
│   ├── engine-api.md      # the TypeScript API for later integration
│   └── http-api.md        # POST /api/viz/generate
└── tasks.md
```

### Source Code (repository root)

```text
src/viz/                       # pure engine, no DOM, importable from server and client
├── index.ts                   # public API barrel
├── schema.ts                  # zod scene v1 + parseScene (structure + references)
├── state.ts                   # fold steps into frame states; describeFrame
├── layout.ts                  # state -> DrawItem[] (per element type), graph layouts
├── geometry.ts                # text width estimates, wrapping, edge clipping, link paths
├── interpolate.ts             # blend two DrawItem lists; easing
├── vnode.ts                   # DrawItem[] -> virtual SVG nodes (shared by both serializers)
├── svg.ts                     # vnodes -> SVG string (renderSvg)
├── theme.ts                   # token names, fallback light/dark palettes, paint()
├── timeline.ts                # time model: frame at t, step durations, reduced motion
├── templates.ts               # codeTrace, arraySort, contradiction, argumentMap builders
├── examples/                  # hand-written gallery scenes (code, algorithm, argument, perf)
└── react/
    ├── VizPlayer.tsx          # player with controls, keyboard, captions, text alternative
    ├── VizFrame.tsx           # static frame (vnodes -> React elements)
    ├── exportImage.ts         # browser-only: palette from CSS vars, SVG + PNG download
    └── viz.module.css

src/server/viz/
├── generate.ts                # generateScene(): call, validate, retry once, force ai-suggested
├── prompt.ts                  # system prompt + compact schema guide
└── fake.ts                    # deterministic fake responder (tag "viz_generate") built from templates

src/app/api/viz/generate/route.ts   # POST, providerReady() first, nothing written
src/app/dev/viz/page.tsx            # preview page (server shell)
src/app/dev/viz/VizPreview.tsx      # gallery, paste-to-render, paste-to-generate (client)

tests/unit/f14-*.test.ts            # schema, state, layout/interpolation, svg, templates, generator, guards, perf
tests/integration/f14-viz-generate.test.ts   # route: ok, retry, fail, provider not ready, limits
tests/e2e/f14-viz.spec.ts           # gallery play/pause/step/scrub, export SVG/PNG, keyboard, generate, perf p95
```

**Structure Decision**: all code in new folders (`src/viz`, `src/server/viz`, `src/app/dev/viz`,
`src/app/api/viz`). Styles live in a CSS module so `globals.css` is untouched. Errors are mapped
inside the viz route, so `withApi` is untouched. The only shared file edited is
`playwright.config.ts`, to let `NEXT_DIST_DIR` be overridden for a private build folder (logged in
STATUS.md first).

## Complexity Tracking

No violations.
