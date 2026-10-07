// The client's view of the message graph: one graphology DirectedGraph, parent → child, built from
// the canvas payload and merged incrementally as actions return rows (research R13).
import { DirectedGraph } from "graphology";
import type { Element } from "@/shared/schemas";

export type CanvasGraph = {
  graph: DirectedGraph<{ element: Element }>;
};

const order = (a: Element, b: Element) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function buildGraph(elements: Iterable<Element>): CanvasGraph {
  const g: CanvasGraph = { graph: new DirectedGraph() };
  mergeGraph(g, elements);
  return g;
}

/**
 * Adds or replaces elements. Returns the trees whose structure or content changed, so only those
 * are laid out again (SC-009).
 */
export function mergeGraph(g: CanvasGraph, elements: Iterable<Element>): Set<string> {
  const changed = new Set<string>();
  const list = [...elements];
  for (const el of list) {
    const before = g.graph.hasNode(el.id) ? g.graph.getNodeAttribute(el.id, "element") : null;
    if (before && sameElement(before, el)) continue;
    if (before) g.graph.setNodeAttribute(el.id, "element", el);
    else g.graph.addNode(el.id, { element: el });
    changed.add(el.treeId);
  }
  // Edges after every node exists: a child can arrive in the same batch as its parent.
  for (const el of list) {
    if (el.parentId && g.graph.hasNode(el.parentId) && !g.graph.hasEdge(el.parentId, el.id)) {
      g.graph.addEdge(el.parentId, el.id);
    }
  }
  return changed;
}

function sameElement(a: Element, b: Element): boolean {
  return (
    a.text === b.text &&
    a.status === b.status &&
    a.state === b.state &&
    a.partialText === b.partialText &&
    a.review === b.review &&
    a.note === b.note &&
    a.manual?.x === b.manual?.x &&
    a.manual?.y === b.manual?.y
  );
}

export function element(g: CanvasGraph, id: string): Element | undefined {
  return g.graph.hasNode(id) ? g.graph.getNodeAttribute(id, "element") : undefined;
}

/** Children in creation order, then id (the order siblings are laid out in). */
export function children(g: CanvasGraph, id: string): Element[] {
  if (!g.graph.hasNode(id)) return [];
  return g.graph
    .outNeighbors(id)
    .map((c) => g.graph.getNodeAttribute(c, "element"))
    .sort(order);
}

/**
 * The child that continues a column: the earliest child that isn't an anchored branch (a branch
 * from a span fans out to the side, research R10).
 */
export function firstChild(g: CanvasGraph, id: string, visible?: (el: Element) => boolean): Element | undefined {
  return children(g, id).find((c) => !c.anchor && c.kind !== "function" && (!visible || visible(c)));
}

/** Ancestors from the origin down to the element's parent (its context path, FR-026). */
export function ancestors(g: CanvasGraph, id: string): Element[] {
  const out: Element[] = [];
  let cur = element(g, id)?.parentId ?? null;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const el = element(g, cur);
    if (!el) break;
    out.push(el);
    cur = el.parentId;
  }
  return out.reverse();
}

export function siblings(g: CanvasGraph, id: string): Element[] {
  const parent = element(g, id)?.parentId;
  return parent ? children(g, parent) : [];
}
