---
description: "Task list for feature 014, Farabi visualization engine"
---

# Tasks: Farabi Visualization Engine

**Input**: Design documents from `specs/014-visualization-engine/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: requested by the coordinator brief (unit, integration with the fake provider, e2e
gallery + generate, performance p95), so each story includes test tasks.

## Phase 1: Setup

- [ ] T001 Log the lane start and planned shared-file edit (playwright.config.ts `NEXT_DIST_DIR` override) in /Users/halda/Projects/farabi-coord/STATUS.md
- [ ] T002 Create folders src/viz/, src/viz/examples/, src/viz/react/, src/server/viz/, src/app/dev/viz/, src/app/api/viz/generate/

## Phase 2: Foundational (blocks all stories)

- [ ] T003 Scene v1 zod schema in src/viz/schema.ts: `version: 1`, `title` 1–120 chars, `description` 1–1000 chars, `family` code|algorithm|argument|general, `origin` user-authored|ai-suggested, `width` 200–2000 / `height` 120–2000 default 800 × 450, `elements` 1–200 with unique ids matching `^[A-Za-z][A-Za-z0-9_-]{0,39}$`, `steps` 0–100, step `caption` 1–300 chars, `durationMs` 0–10000 default 900, ≤ 50 actions; the 8 element types and 12 actions of contracts/scene-v1.md as strict objects
- [ ] T004 Frame-state fold in src/viz/state.ts: initial state from elements, `applyAction` for every op with transient marks reset per step, strict mode that reports problems with paths; `computeStates`, `captionAt`, `describeFrame`, `textAlternative`
- [ ] T005 `parseScene()` in src/viz/schema.ts: zod structure, connector endpoints, graph edge endpoints and node count toward the 200 limit, then simulate steps via src/viz/state.ts and add located problems; returns `{ ok, scene | problems }`
- [ ] T006 [P] Theme tokens and fallback light/dark palettes (values from polish tokens) and `paint()` in src/viz/theme.ts
- [ ] T007 [P] Geometry helpers in src/viz/geometry.ts: width estimates (mono 0.6 em, prose 0.56 em), wrap, ellipsize, rect clipping, link and arrowhead/bar/zigzag paths
- [ ] T008 Layout in src/viz/layout.ts: state → keyed DrawItem[] for box, text, connector, code, array (cells keyed by identity, pointers keyed by name), panel, stack, graph (tree, layered, circle, row, manual layouts); AI-suggested badge
- [ ] T009 [P] Interpolation and easing in src/viz/interpolate.ts (numbers lerp, strings/paints switch at 0.5, one-sided items fade)
- [ ] T010 [P] Timeline in src/viz/timeline.ts: `drawAt(scene, t)` with per-frame draw-list cache, move/dwell split (55%), reduced-motion mode
- [ ] T011 Virtual SVG nodes in src/viz/vnode.ts and string serializer `renderSvg` in src/viz/svg.ts (title, desc, role="img", literal palette or CSS vars)
- [ ] T012 Public barrel src/viz/index.ts
- [ ] T013 [P] Unit tests tests/unit/f14-schema.test.ts (valid scenes, invalid set with located problems: unknown version, duplicate ids, bad connector, out-of-range cell, unknown row/frame/node, pop on empty, bad op target type, limits)
- [ ] T014 [P] Unit tests tests/unit/f14-state.test.ts (swap keeps identity, compare transient, pointer move/hide, push/pop, set adds panel row, line/tokens, show/hide parts, describeFrame text)
- [ ] T015 [P] Unit tests tests/unit/f14-render.test.ts (deterministic draw, interpolation midpoints, SVG parses as XML via jsdom, title/desc present, palette literal vs var, AI badge on ai-suggested)

## Phase 3: User Story 1 - Watch a hand-written visualization (P1) MVP

**Goal**: any valid scene plays with controls, keyboard, captions and text alternative.
**Independent test**: open a gallery example; Play, Pause, Next, Previous, scrub, keys.

- [ ] T016 [P] [US1] Templates in src/viz/templates.ts: `codeTrace`, `arraySort` (bubble, insertion), `contradiction`, `argumentMap`
- [ ] T017 [P] [US1] Hand-written examples in src/viz/examples/ (code: factorial recursion with call stack and vars, loop sum; algorithm: bubble sort, binary search with pointers, BFS on a graph, BST insert tree; argument: contradiction of two statements, small argument map) and `GALLERY`, plus a 200-element perf scene `perfScene()`
- [ ] T018 [US1] Static frame component src/viz/react/VizFrame.tsx (vnodes → React elements)
- [ ] T019 [US1] Player src/viz/react/VizPlayer.tsx: rAF clock, play/pause/prev/next/start/end, scrubber (range over continuous t), speed, prefers-reduced-motion, keyboard (Space, ←, →, Home, End), visible + aria-live caption, step counter, text alternative disclosure, AI-suggested badge; styles in src/viz/react/viz.module.css
- [ ] T020 [US1] React barrel src/viz/react/index.ts
- [ ] T021 [P] [US1] Unit tests tests/unit/f14-templates.test.ts (every template and gallery scene passes parseScene; every frame has a caption and summary)

## Phase 4: User Story 2 - Export a frame as an image (P1)

**Goal**: SVG and PNG of the current (even in-between) frame; server-side SVG identical.

- [ ] T022 [US2] Browser export in src/viz/react/exportImage.ts: `readPalette()` from CSS custom properties with scheme fallbacks, `exportSvg`, `exportPng` (Blob URL → Image → canvas 2× → toBlob), download helper
- [ ] T023 [US2] Export buttons in src/viz/react/VizPlayer.tsx
- [ ] T024 [P] [US2] Unit test in tests/unit/f14-render.test.ts: server `renderSvg` equals the string the browser export builds for the same palette and t (SC-006)

## Phase 5: User Story 3 - Generate from text (P2)

**Goal**: AI proposes a scene; validated, retried once, ai-suggested; clean failure.

- [ ] T025 [P] [US3] Prompt in src/server/viz/prompt.ts: system prompt with the compact scene guide, family hints, Article III rules (depict only what's in the text; no verdicts; no claims about the user), `<input>` block
- [ ] T026 [P] [US3] Fake responder in src/server/viz/fake.ts built from templates (code → codeTrace, numbers → arraySort, otherwise contradiction) and `installVizFakes()`
- [ ] T027 [US3] Generator src/server/viz/generate.ts: text 1–20,000 chars, family auto|code|algorithm|argument, ask with tag `viz_generate`, effort medium, maxTokens 8000, `extractJson` + `parseScene`, retry once with problems, force `origin: "ai-suggested"`, `VizGenerationError`; barrel src/server/viz/index.ts
- [ ] T028 [US3] Route src/app/api/viz/generate/route.ts: `withApi`, body schema, `providerReady()` first, `installVizFakes()`, pass `req.signal`, 503 `viz_unavailable` mapping, nothing written
- [ ] T029 [P] [US3] Unit tests tests/unit/f14-generate.test.ts (ok first try, invalid then valid, invalid twice throws, provider fail throws, origin forced, prompt guard for Article III phrases, limits refused without AI call)
- [ ] T030 [P] [US3] Integration tests tests/integration/f14-viz-generate.test.ts (200 scene, 422 invalid body/oversized, 422 provider_not_ready no_api_key without AI call, 503 when fake fails, no rows written)

## Phase 6: User Story 4 - Gallery and preview page (P3)

- [ ] T031 [US4] Server shell src/app/dev/viz/page.tsx (metadata title "Visualizations · Farabi")
- [ ] T032 [US4] Client preview src/app/dev/viz/VizPreview.tsx: gallery list by family, player, paste JSON → Render with problems list, paste text → Generate (family, AbortController, error with Settings link on provider_not_ready), `?scene=perf` loads the 200-element scene
- [ ] T033 [US4] E2E tests/e2e/f14-viz.spec.ts: gallery play/pause/step/scrub with captions, keyboard, export SVG and PNG downloads, render invalid JSON shows problems, generate with fake (ok and fail mode), 200-element p95 frame time logged and ≤ 20 ms

## Phase 7: Polish & cross-cutting

- [ ] T034 Guard test tests/unit/f14-guards.test.ts: no `eval(`, `new Function`, `Function(` in src/viz and src/server/viz; src/viz has no DOM or server imports outside src/viz/react
- [ ] T035 Make playwright.config.ts honour `NEXT_DIST_DIR` from the environment (default `.next-test`)
- [ ] T036 Run tsc, eslint, vitest (pg and pglite), full Playwright on port 3140; record results and perf p95
- [ ] T037 Hand-off entry in /Users/halda/Projects/farabi-coord/STATUS.md

## Dependencies

- Phase 2 blocks everything. US1 (player) and US2 (export) share the player; US2 after T019.
- US3 depends only on Phase 2 + templates (T016) for the fake. US4 depends on US1–US3.

## Parallel examples

- T006, T007, T009, T010 in parallel after T003/T004.
- T013–T015 in parallel once T011 lands.
- T025, T026 in parallel; T029, T030 in parallel after T028.

## Implementation strategy

MVP = Phase 2 + US1 (a scene plays). Then US2 (stills), US3 (generation), US4 (preview page + e2e).
