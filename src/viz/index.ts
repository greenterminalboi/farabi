// Feature 014: the Farabi visualization engine (contracts/engine-api.md). Pure functions only: safe
// to import on the server, in the browser and in tests. React pieces live in `@/viz/react`.
export * from "./schema";
export { parseScene, sceneOrThrow } from "./validate";
export { computeStates, captionAt, describeFrame, describeState, frameCount, textAlternative, type FrameState } from "./state";
export { drawAt, drawFrame, statesOf, tick, stepDuration, clampT, MOVE_SHARE, type Playhead, type TickOptions } from "./timeline";
export { renderSvg, serialize, type RenderSvgOptions } from "./svg";
export { layoutFrame, sceneSize } from "./layout";
export { svgTree, type VNode } from "./vnode";
export { VIZ_TOKENS, FALLBACK_PALETTES, type Palette, type Scheme, type VizToken } from "./theme";
export type { DrawItem } from "./draw";
export { codeTrace, arraySort, contradiction, argumentMap, type TraceStep } from "./templates";
export { GALLERY, perfScene, type GalleryEntry } from "./examples";
