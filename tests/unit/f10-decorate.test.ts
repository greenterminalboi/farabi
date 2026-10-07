// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { makeDecorate } from "@/canvas/text/decorate";
import { renderBlocks } from "@/canvas/text/render";
import { parseRichText, plainRichText } from "@/canvas/text/richText";
import { buildMatcher, termKey } from "@/lib/terms";

// Markers, terms and suggestions on mounted text (FR-035, FR-056; Features 2 and 5).

function render(source: string, opts: { markers?: Array<{ id: string; start: number; end: number }>; terms?: string[]; suggest?: boolean; plain?: boolean }) {
  const el = document.createElement("div");
  const rich = opts.plain ? plainRichText(source) : parseRichText(source);
  const matcher = opts.terms ? buildMatcher(opts.terms.map((t, i) => ({ id: `d${i}`, term: t, termKey: termKey(t) }))) : null;
  renderBlocks(el, rich.blocks, false, makeDecorate({ markers: opts.markers ?? [], matcher, suggestBold: opts.suggest ?? false }));
  return el;
}

const spans = (el: HTMLElement, sel: string) =>
  [...el.querySelectorAll<HTMLElement>(sel)].map((s) => [s.textContent, s.dataset.start, s.dataset.end]);

describe("Feature 10 · decorations", () => {
  it("underlines each bold span as a suggestion with exact source offsets, and nothing else (Feature 5)", () => {
    const source = "Pods run **containers** and use __shared volumes__ for storage.";
    const el = render(source, { suggest: true });
    const marks = [...el.querySelectorAll<HTMLElement>("[data-suggest]")];
    expect(marks.map((m) => m.textContent)).toEqual(["containers", "shared volumes"]);
    for (const m of marks) {
      const [start, end] = m.dataset.suggest!.split("-").map(Number);
      expect(source.slice(start, end)).toBe(m.textContent);
      expect(m.classList.contains("suggest-mark")).toBe(true);
    }
  });

  it("finds bold inside lists and headings, splitting around inline code", () => {
    const el = render("# About **Pods**\n\n- **Scheduling** matters\n- **uses `kubectl` daily**", { suggest: true });
    expect([...el.querySelectorAll("[data-suggest]")].map((m) => m.textContent)).toEqual(["Pods", "Scheduling", "uses ", " daily"]);
  });

  it("marks nothing when suggestions are off or there is no bold", () => {
    expect(render("Pods run **containers**.", {}).querySelectorAll("[data-suggest]")).toHaveLength(0);
    expect(render("Pods run *containers* in prose.", { suggest: true }).querySelectorAll("[data-suggest]")).toHaveLength(0);
  });

  it("splits at overlapping markers, layering them, on plain text too", () => {
    const source = "Ask about pods and services";
    const el = render(source, { plain: true, markers: [{ id: "e1", start: 4, end: 14 }, { id: "e2", start: 10, end: 18 }] });
    const marked = [...el.querySelectorAll<HTMLElement>("[data-markers]")].map((s) => [s.textContent, s.dataset.markers, s.className]);
    expect(marked).toEqual([
      ["about ", "e1", "marker depth-1"],
      ["pods", "e1 e2", "marker depth-2"],
      [" and", "e2", "marker depth-1"],
    ]);
    // Every piece keeps exact offsets into the stored text, so a selection across them still maps.
    for (const [text, start, end] of spans(el, "span[data-start]")) expect(source.slice(Number(start), Number(end))).toBe(text);
  });

  it("underlines collected terms, whatever their case", () => {
    const el = render("Containers hold **containers**.", { terms: ["Containers"], suggest: true });
    const terms = [...el.querySelectorAll<HTMLElement>(".term-mark")];
    expect(terms.map((t) => [t.textContent, t.dataset.defId])).toEqual([
      ["Containers", "d0"],
      ["containers", "d0"],
    ]);
  });
});
