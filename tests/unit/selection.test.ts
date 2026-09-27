// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { selectionToAnchor } from "@/components/chat/selection";

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
const html = `<article data-message-id="m1"><p><span data-start="0" data-end="6">Hello </span><strong><span data-start="8" data-end="12">bold</span></strong><span data-start="14" data-end="20"> world</span></p></article>
<article data-message-id="m2"><p><span data-start="0" data-end="5">Other</span></p></article>`;
const contentOf = (id: string) => (id === "m1" ? content : id === "m2" ? "Other" : undefined);

describe("selectionToAnchor", () => {
  it("maps a selection across formatting to raw offsets", () => {
    const root = render(html);
    const spans = root.querySelectorAll("span");
    const anchor = selectionToAnchor(rangeOf(spans[0].firstChild!, 2, spans[2].firstChild!, 3), contentOf);
    expect(anchor).toEqual({
      messageId: "m1",
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
    render(`<article data-message-id="m3"><span data-start="0" data-end="101">${long}</span></article>`);
    const t = document.querySelector("span")!.firstChild!;
    const anchor = selectionToAnchor(rangeOf(t, 50, t, 51), () => long)!;
    expect(anchor.text).toBe("X");
    expect(anchor.prefix).toHaveLength(32);
    expect(anchor.suffix).toHaveLength(32);
  });

  it("returns null for empty, whitespace-only and cross-message selections", () => {
    const root = render(html);
    const spans = root.querySelectorAll("span");
    const first = spans[0].firstChild!;
    expect(selectionToAnchor(rangeOf(first, 1, first, 1), contentOf)).toBeNull();
    expect(selectionToAnchor(rangeOf(first, 5, first, 6), contentOf)).toBeNull();
    expect(selectionToAnchor(rangeOf(first, 0, spans[3].firstChild!, 2), contentOf)).toBeNull();
  });
});
