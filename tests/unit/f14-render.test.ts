import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { drawAt, drawFrame, FALLBACK_PALETTES, GALLERY, perfScene, renderSvg, sceneOrThrow, type Scene, VIZ_TOKENS } from "@/viz";
import { blend } from "@/viz/interpolate";
import { exportSvgString } from "@/viz/react/exportImage";

// Feature 014: layout, interpolation and SVG stills (FR-006, FR-007, FR-011, FR-012, SC-006).

const sort = GALLERY.find((g) => g.id === "bubble-sort")!.scene;

function parseSvg(svg: string) {
  const doc = new JSDOM(svg, { contentType: "image/svg+xml" }).window.document;
  expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
  return doc;
}

describe("Feature 014 · rendering", () => {
  it("is deterministic", () => {
    expect(renderSvg(sort, 3)).toBe(renderSvg(sort, 3));
    expect(drawAt(sort, 2.5)).toEqual(drawAt(sort, 2.5));
  });

  it("produces well-formed, accessible SVG for every gallery frame", () => {
    for (const { scene } of GALLERY) {
      for (const t of [0, scene.steps.length / 2, scene.steps.length]) {
        const doc = parseSvg(renderSvg(scene, t));
        const svg = doc.documentElement;
        expect(svg.getAttribute("role")).toBe("img");
        expect(doc.getElementsByTagName("title")[0].textContent).toContain(scene.title);
        expect(doc.getElementsByTagName("desc")[0].textContent).toContain(scene.description);
        expect(svg.getAttribute("viewBox")).toMatch(/^0 0 \d+/);
      }
    }
  });

  it("stills carry literal colours; dark stills use the dark palette", () => {
    const light = renderSvg(sort, 1);
    expect(light).not.toContain("var(--");
    expect(light).toContain(FALLBACK_PALETTES.light.bg);
    const dark = renderSvg(sort, 1, { scheme: "dark" });
    expect(dark).toContain(FALLBACK_PALETTES.dark.bg);
  });

  it("on-screen paints map the app's tokens with the same per-scheme fallbacks (FR-010)", () => {
    const css = readFileSync(path.resolve(import.meta.dirname, "../../src/viz/react/viz.module.css"), "utf8");
    const dark = css.slice(css.indexOf("prefers-color-scheme: dark"));
    for (const t of VIZ_TOKENS) {
      expect(css).toContain(`--viz-${t}: var(--${t}, ${FALLBACK_PALETTES.light[t]});`);
      expect(dark).toContain(`--viz-${t}: var(--${t}, ${FALLBACK_PALETTES.dark[t]});`);
    }
    expect(renderSvg(sort, 0, { palette: undefined })).not.toContain("var(");
  });

  it("server stills equal the browser export for the same palette (SC-006)", () => {
    const palette = { ...FALLBACK_PALETTES.dark, accent: "#123456" };
    for (const t of [0, 1.37, sort.steps.length]) {
      expect(exportSvgString(sort, t, palette)).toBe(renderSvg(sort, t, { palette, idPrefix: "viz-export" }));
    }
  });

  it("interpolates by key: a swapped cell slides between its two positions", () => {
    const swapStep = sort.steps.findIndex((s) => s.actions.some((a) => a.op === "swap")) + 1;
    const before = drawFrame(sort, swapStep - 1);
    const after = drawFrame(sort, swapStep);
    const cellKey = "arr:c0";
    const x0 = (before.find((i) => i.key === cellKey) as { x: number }).x;
    const x1 = (after.find((i) => i.key === cellKey) as { x: number }).x;
    expect(x0).not.toBe(x1);
    const mid = blend(before, after, 0.5).find((i) => i.key === cellKey) as { x: number };
    expect(mid.x).toBeCloseTo((x0 + x1) / 2);
  });

  it("items present on one side only fade", () => {
    const a = [{ kind: "text", key: "gone", x: 0, y: 0, text: "a", size: 1, weight: 400, anchor: "start", fill: "text", mono: false, italic: false, opacity: 1 }] as const;
    const b = [{ ...a[0], key: "new" }];
    const mid = blend([...a], b, 0.25);
    expect(mid.find((i) => i.key === "new")!.opacity).toBeCloseTo(0.25);
    expect(mid.find((i) => i.key === "gone")!.opacity).toBeCloseTo(0.75);
  });

  it("hidden elements are not drawn; revealing fades them in", () => {
    const tension = GALLERY.find((g) => g.id === "contradiction")!.scene;
    expect(drawFrame(tension, 0).some((i) => i.key === "a")).toBe(false);
    expect(drawFrame(tension, 1).some((i) => i.key === "a")).toBe(true);
    const half = drawAt(tension, 0.5).find((i) => i.key === "a")!;
    expect(half.opacity).toBeGreaterThan(0);
    expect(half.opacity).toBeLessThan(1);
  });

  it("marks AI-suggested scenes visibly, also in stills (FR-016)", () => {
    const ai: Scene = { ...sort, origin: "ai-suggested" };
    const svg = renderSvg(ai, 0);
    expect(svg).toContain(">AI-suggested</text>");
    expect(svg).toContain("<title id=\"viz-title\">Bubble sort of 5 numbers (AI-suggested)</title>");
    expect(renderSvg(sort, 0)).not.toContain("AI-suggested");
  });

  it("escapes text and keeps code indentation", () => {
    const s = sceneOrThrow({
      version: 1,
      title: "<b>&",
      description: "d",
      family: "code",
      origin: "user-authored",
      elements: [{ type: "code", id: "c", x: 0, y: 0, lines: ["if (a < b && c) {", "    go();"] }],
      steps: [],
    });
    const svg = renderSvg(s, 0);
    parseSvg(svg);
    expect(svg).toContain("&lt;b&gt;&amp;");
    expect(svg).toContain('xml:space="preserve"');
    expect(svg).toContain(">    go();</text>");
  });

  it("draws a 200-element in-between frame quickly", () => {
    const perf = perfScene();
    drawAt(perf, 0.5);
    const start = performance.now();
    for (let i = 0; i < 100; i++) drawAt(perf, (i % 24) + 0.5);
    const per = (performance.now() - start) / 100;
    expect(per).toBeLessThan(8);
  });
});
