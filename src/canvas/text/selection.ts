import type { Span } from "@/shared/schemas";

/** A selection inside one element's text, as raw offsets in that text (FR-016). */
export type SelectionAnchor = Span & { nodeId: string };

type Boundary = { node: Node; offset: number };

function spanOf(node: Node): HTMLElement | null {
  const el = node.nodeType === 3 ? node.parentElement : (node as Element);
  return el?.closest<HTMLElement>("span[data-start]") ?? null;
}

function itemOf(node: Node): HTMLElement | null {
  const el = node.nodeType === 3 ? node.parentElement : (node as Element);
  return el?.closest<HTMLElement>("[data-node-id]") ?? null;
}

/** First (or last) mapped text node at or inside an element boundary. */
function textAt(boundary: Boundary, edge: "start" | "end"): Boundary | null {
  const { node, offset } = boundary;
  if (node.nodeType === 3) return boundary;
  const doc = node.ownerDocument!;
  const walker = doc.createTreeWalker(node, 4 /* NodeFilter.SHOW_TEXT */);
  const texts: Text[] = [];
  for (let t = walker.nextNode(); t; t = walker.nextNode()) texts.push(t as Text);
  const children = Array.from(node.childNodes);
  if (edge === "start") {
    const pivot = children[offset];
    const found = texts.find(
      (t) => !pivot || pivot === t || pivot.contains(t) || pivot.compareDocumentPosition(t) & 4,
    );
    return found ? { node: found, offset: 0 } : null;
  }
  const pivot = children[offset - 1];
  const before = texts.filter(
    (t) => !pivot || pivot === t || pivot.contains(t) || t.compareDocumentPosition(pivot) & 4,
  );
  const found = before.at(-1);
  return found ? { node: found, offset: found.data.length } : null;
}

function rawOffset(boundary: Boundary, edge: "start" | "end"): number | null {
  const text = textAt(boundary, edge);
  if (!text) return null;
  const span = spanOf(text.node);
  if (!span) return null;
  const start = Number(span.dataset.start);
  const end = Number(span.dataset.end);
  const raw = start + text.offset;
  return raw >= start && raw <= end ? raw : null;
}

/**
 * Maps a DOM selection inside one element's mounted text to raw offsets in its stored text (research
 * R9). Only mounted text can be selected, so a selection on clipped text covers the visible part
 * only (FR-033). Returns null for empty, whitespace-only, cross-element or unmappable selections.
 */
export function selectionToAnchor(
  range: Pick<Range, "startContainer" | "startOffset" | "endContainer" | "endOffset" | "collapsed">,
  contentOf: (nodeId: string) => string | undefined,
): SelectionAnchor | null {
  if (range.collapsed) return null;
  const startItem = itemOf(range.startContainer);
  const endItem = itemOf(range.endContainer);
  if (!startItem || startItem !== endItem) return null;
  const nodeId = startItem.dataset.nodeId!;
  const content = contentOf(nodeId);
  if (content === undefined) return null;

  const start = rawOffset({ node: range.startContainer, offset: range.startOffset }, "start");
  const end = rawOffset({ node: range.endContainer, offset: range.endOffset }, "end");
  if (start === null || end === null || end <= start) return null;
  const text = content.slice(start, end);
  if (text.trim() === "") return null;
  return {
    nodeId,
    start,
    end,
    text,
    prefix: content.slice(Math.max(0, start - 32), start),
    suffix: content.slice(end, end + 32),
  };
}

/** The text node and offset inside it for raw offset `raw`, searching mapped spans in `root`. */
function textPoint(root: HTMLElement, raw: number, edge: "start" | "end"): Boundary | null {
  for (const span of root.querySelectorAll<HTMLElement>("span[data-start]")) {
    const start = Number(span.dataset.start);
    const end = Number(span.dataset.end);
    const inside = edge === "start" ? start <= raw && raw < end : start < raw && raw <= end;
    const text = span.firstChild;
    if (inside && text?.nodeType === 3) return { node: text, offset: raw - start };
  }
  return null;
}

/**
 * The DOM range over raw offsets [start, end) of a mounted item: the inverse of
 * `selectionToAnchor` (Feature 5). Null when either end isn't in mounted, mapped text.
 */
export function rangeForOffsets(itemEl: HTMLElement, start: number, end: number): Range | null {
  const from = textPoint(itemEl, start, "start");
  const to = textPoint(itemEl, end, "end");
  if (!from || !to) return null;
  const range = itemEl.ownerDocument.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}
