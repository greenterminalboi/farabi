// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { rangeForOffsets, selectionToAnchor } from "@/canvas/text/selection";

function render(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

function rangeOf(startNode: Node, startOffset: number, endNode: Node, endOffset: number): Range {
  const r = document.createRange();
  r.setStart(startNode, startOffset);
  r.setEnd(endNode, endOffset);
  return r;
}

// "Hello **bold** world" -> text spans: "Hello " [0,6), "bold" [8,12), " world" [14,20)
const content = "Hello **bold** world";
const html = `<article data-node-id="m1"><p><span data-start="0" data-end="6">Hello </span><strong><span data-start="8" data-end="12">bold</span></strong><span data-start="14" data-end="20"> world</span></p></article>
<article data-node-id="m2"><p><span data-start="0" data-end="5">Other</span></p></article>`;
const contentOf = (id: string) => (id === "m1" ? content : id === "m2" ? "Other" : undefined);

describe("selectionToAnchor", () => {
  it("maps a selection across formatting to raw offsets", () => {
    const root = render(html);
    const spans = root.querySelectorAll("span");
    const anchor = selectionToAnchor(rangeOf(spans[0].firstChild!, 2, spans[2].firstChild!, 3), contentOf);
    expect(anchor).toEqual({
      nodeId: "m1",
      start: 2,
      end: 17,
      text: "llo **bold** wo",
      prefix: "He",
      suffix: "rld",
    });
  });

  it("maps a selection inside one formatted span", () => {
    const root = render(html);
    const bold = root.querySelectorAll("span")[1].firstChild!;
    expect(selectionToAnchor(rangeOf(bold, 0, bold, 4), contentOf)?.text).toBe("bold");
  });

  it("limits prefix and suffix to 32 characters", () => {
    const long = "a".repeat(50) + "X" + "b".repeat(50);
    render(`<article data-node-id="m3"><span data-start="0" data-end="101">${long}</span></article>`);
    const t = document.querySelector("span")!.firstChild!;
    const anchor = selectionToAnchor(rangeOf(t, 50, t, 51), () => long)!;
    expect(anchor.text).toBe("X");
    expect(anchor.prefix).toHaveLength(32);
    expect(anchor.suffix).toHaveLength(32);
  });

  it("returns null for empty, whitespace-only and cross-element selections", () => {
    const root = render(html);
    const spans = root.querySelectorAll("span");
    const first = spans[0].firstChild!;
    expect(selectionToAnchor(rangeOf(first, 1, first, 1), contentOf)).toBeNull();
    expect(selectionToAnchor(rangeOf(first, 5, first, 6), contentOf)).toBeNull();
    expect(selectionToAnchor(rangeOf(first, 0, spans[3].firstChild!, 2), contentOf)).toBeNull();
  });
});

describe("rangeForOffsets (Feature 5)", () => {
  const roundTrip = (nodeId: string, start: number, end: number) => {
    const el = document.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`)!;
    const range = rangeForOffsets(el, start, end);
    expect(range).not.toBeNull();
    return selectionToAnchor(range!, contentOf);
  };

  it("selects plain text exactly as a manual selection would", () => {
    render(html);
    expect(roundTrip("m1", 1, 5)).toMatchObject({ start: 1, end: 5, text: "ello" });
  });

  it("selects across a formatted element", () => {
    render(html);
    expect(roundTrip("m1", 0, 20)).toMatchObject({ start: 0, end: 20, text: content });
  });

  it("selects across a marker segment boundary", () => {
    render(`<article data-node-id="m1"><span data-start="0" data-end="3">Hel</span><span class="marker" data-start="3" data-end="9">lo **b</span></article>`);
    expect(roundTrip("m1", 1, 7)).toMatchObject({ start: 1, end: 7, text: "ello *" });
  });

  it("returns null when an end falls in unmapped text", () => {
    render(html);
    const el = document.querySelector<HTMLElement>('[data-node-id="m1"]')!;
    expect(rangeForOffsets(el, 7, 10)).toBeNull();
  });
});

describe("selection on clipped text (Feature 10, FR-033)", () => {
  it("maps a selection ending at a clipped item's last mounted span to the visible part only", () => {
    const full = "The visible start of a long answer, and much more text that is not mounted.";
    const root = render(
      `<div data-node-id="long"><div class="element-header"><span>AI</span></div><div class="element-body"><p><span data-start="0" data-end="34" data-clipped="true">The visible start of a long answer</span></p></div></div>`,
    );
    const span = root.querySelector("span[data-start]")!.firstChild!;
    const anchor = selectionToAnchor(rangeOf(span, 4, span, 34), (id) => (id === "long" ? full : undefined));
    expect(anchor).toMatchObject({ nodeId: "long", start: 4, end: 34, text: "visible start of a long answer" });
    // A selection reaching into the frame's header maps to nothing.
    const header = root.querySelector(".element-header span")!.firstChild!;
    expect(selectionToAnchor(rangeOf(header, 0, span, 3), () => full)).toBeNull();
  });
});

