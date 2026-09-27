import type { Anchor } from "@/shared/schemas";

type Boundary = { node: Node; offset: number };

function spanOf(node: Node): HTMLElement | null {
  const el = node.nodeType === 3 ? node.parentElement : (node as Element);
  return el?.closest<HTMLElement>("span[data-start]") ?? null;
}

function messageOf(node: Node): HTMLElement | null {
  const el = node.nodeType === 3 ? node.parentElement : (node as Element);
  return el?.closest<HTMLElement>("[data-message-id]") ?? null;
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
 * Maps a DOM selection inside one message to raw offsets in that message's stored text
 * (research R6). Returns null for empty, whitespace-only, cross-message or unmappable selections.
 */
export function selectionToAnchor(
  range: Pick<Range, "startContainer" | "startOffset" | "endContainer" | "endOffset" | "collapsed">,
  contentOf: (messageId: string) => string | undefined,
): Anchor | null {
  if (range.collapsed) return null;
  const startMsg = messageOf(range.startContainer);
  const endMsg = messageOf(range.endContainer);
  if (!startMsg || startMsg !== endMsg) return null;
  const messageId = startMsg.dataset.messageId!;
  const content = contentOf(messageId);
  if (content === undefined) return null;

  const start = rawOffset({ node: range.startContainer, offset: range.startOffset }, "start");
  const end = rawOffset({ node: range.endContainer, offset: range.endOffset }, "end");
  if (start === null || end === null || end <= start) return null;
  const text = content.slice(start, end);
  if (text.trim() === "") return null;
  return {
    messageId,
    start,
    end,
    text,
    prefix: content.slice(Math.max(0, start - 32), start),
    suffix: content.slice(end, end + 32),
  };
}
