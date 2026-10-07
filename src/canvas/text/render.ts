// Rich text to DOM (research R9). Every run that maps onto the source becomes
// `span[data-start][data-end]`, the contract `selectionToAnchor` and `rangeForOffsets` rely on.
import type { Block, Run } from "./richText";

/**
 * Splits a mapped run into decorated pieces (markers, terms, suggestions). Returns null to render
 * the run as one plain span.
 */
export type Decorate = (run: Run & { start: number; end: number }) => Array<{
  start: number;
  end: number;
  className?: string;
  attrs?: Record<string, string>;
}> | null;

function runElement(doc: Document, run: Run, decorate: Decorate | null): Node {
  const marks = run.marks.length ? run.marks.map((m) => `rt-${m}`).join(" ") : "";
  if (run.start === null || run.end === null) {
    const span = doc.createElement("span");
    if (marks) span.className = marks;
    span.textContent = run.text;
    return span;
  }
  const pieces = decorate?.({ ...run, start: run.start, end: run.end }) ?? null;
  if (!pieces) {
    const span = doc.createElement("span");
    span.dataset.start = String(run.start);
    span.dataset.end = String(run.end);
    if (marks) span.className = marks;
    span.textContent = run.text;
    return span;
  }
  const frag = doc.createDocumentFragment();
  for (const piece of pieces) {
    const span = doc.createElement("span");
    span.dataset.start = String(piece.start);
    span.dataset.end = String(piece.end);
    const cls = [marks, piece.className].filter(Boolean).join(" ");
    if (cls) span.className = cls;
    for (const [k, v] of Object.entries(piece.attrs ?? {})) span.setAttribute(k, v);
    span.textContent = run.text.slice(piece.start - run.start, piece.end - run.start);
    frag.appendChild(span);
  }
  return frag;
}

function blockElement(doc: Document, block: Block, decorate: Decorate | null): HTMLElement {
  const tag = block.tag === "li" ? "div" : block.tag;
  const el = doc.createElement(tag);
  if (block.tag === "li") {
    el.className = block.ordered !== undefined ? "rt-li rt-ol" : "rt-li";
    if (block.ordered !== undefined) el.dataset.n = `${block.ordered}.`;
    el.style.setProperty("--depth", String(block.depth));
  } else if (block.tag === "blockquote") {
    el.style.setProperty("--depth", String(block.depth));
  }
  for (const run of block.runs) el.appendChild(runElement(doc, run, decorate));
  return el;
}

/** Replaces `target`'s children with `blocks`. The last mapped span gets `data-clipped` when cut. */
export function renderBlocks(target: HTMLElement, blocks: Block[], clipped: boolean, decorate: Decorate | null = null): void {
  const doc = target.ownerDocument;
  const frag = doc.createDocumentFragment();
  for (const block of blocks) frag.appendChild(blockElement(doc, block, decorate));
  target.replaceChildren(frag);
  target.classList.toggle("clipped", clipped);
  if (clipped) {
    const spans = target.querySelectorAll<HTMLElement>("span");
    spans[spans.length - 1]?.setAttribute("data-clipped", "true");
  }
}
