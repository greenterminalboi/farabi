# Contract: Engine API (for later integration)

Import pure functions from `@/viz` (safe on server and client) and React pieces from
`@/viz/react`. Server generation lives in `@/server/viz`.

## Pure (`@/viz`)

```ts
parseScene(input: unknown): { ok: true; scene: Scene } | { ok: false; problems: VizProblem[] }
SceneSchema                      // zod schema (structure only; parseScene adds reference checks)
frameCount(scene): number        // steps.length + 1
computeStates(scene): FrameState[]
drawAt(scene, t: number): DrawItem[]           // t in [0, steps.length]; fractional = in-between
renderSvg(scene, t, opts?: { palette?: Palette; scheme?: "light" | "dark" }): string
describeFrame(scene, frame: number): string     // caption + plain-text state summary
captionAt(scene, frame: number): string
textAlternative(scene): string                  // description + every caption
VIZ_TOKENS, FALLBACK_PALETTES                    // theme token names and fallback values
// Templates: build a valid Scene from simple input
codeTrace({ title, source, trace: [{ line, caption, vars?, stack? }] }): Scene
arraySort({ title?, values, algorithm?: "bubble" | "insertion" }): Scene
contradiction({ title?, a, b, tension?, supportsA?, supportsB? }): Scene
argumentMap({ title?, claims: [{ id, text, role? }], relations: [{ from, to, relation }] }): Scene
GALLERY: { family, scene }[]                    // hand-written examples
```

## React (`@/viz/react`, client components)

```tsx
<VizPlayer scene={scene} autoPlay={false} initialFrame={0} onFrameChange={(i) => {}} />
<VizFrame scene={scene} t={2} />                 // static, no controls
exportSvg(scene, t, filename?)                   // browser download, palette from CSS custom properties
exportPng(scene, t, filename?, scale = 2)
readPalette(): Palette                           // current theme as literal colours
exportSvgString(scene, t, palette?): string      // what Export SVG saves, without downloading
pngBlob(scene, t, scale = 2, palette?): Promise<Blob>
```

`exportSvg` / `exportPng` save through an `<a download>` link, which works in browsers. WKWebView
(the desktop shell) may ignore it; a desktop integration should save `exportSvgString` / `pngBlob`
through the host bridge instead.

## Server (`@/server/viz`)

```ts
generateScene(
  { text, family?: "auto" | "code" | "algorithm" | "argument" },
  { model?: string | null; signal?: AbortSignal },
): Promise<Scene>                                // throws VizGenerationError; caller runs providerReady()
installVizFakes()                                // fake provider only; idempotent
```

## Integration notes (not done in this feature)

- A node kind or function would store a Scene JSON and render `<VizPlayer>`; it must map `origin`
  onto Article I's three states (ai-suggested until the user confirms).
- A drill problem could call `codeTrace` or `generateScene` with the problem's code.
- Thumbnails: `renderSvg(scene, frameCount(scene) - 1, { palette: FALLBACK_PALETTES.light })` on the
  server.
