import type { Element, Tree } from "@/shared/schemas";
import { type CanvasGraph, children, element, firstChild } from "../graph";
import { displayOf, widthOf } from "../geometry";
import { type LayoutNode, layoutTree, type TreeLayout } from "./treeLayout";

export const TREE_GAP = 80;

export type Box = { minX: number; minY: number; maxX: number; maxY: number };

export type ForestLayout = {
  /** Top-left of every visible element's box, in world coordinates. */
  positions: Map<string, { x: number; y: number }>;
  boxes: Map<string, Box>;
  relocations: Array<{ treeId: string; x: number; y: number }>;
};

export type LayoutCache = Map<string, TreeLayout>;

const offset = (b: Box, x: number, y: number): Box => ({
  minX: b.minX + x,
  maxX: b.maxX + x,
  minY: b.minY + y,
  maxY: b.maxY + y,
});

const overlaps = (a: Box, b: Box) =>
  a.minX < b.maxX + TREE_GAP && a.maxX + TREE_GAP > b.minX && a.minY < b.maxY + TREE_GAP && a.maxY + TREE_GAP > b.minY;

export type LayoutInput = {
  graph: CanvasGraph;
  /** Hidden elements (rejected outputs) are left out of layout entirely (FR-050). */
  visible: (el: Element) => boolean;
  height: (el: Element) => number;
};

/** The layout model of one element's subtree: column child first, then the rest (research R10). */
export function layoutModel(input: LayoutInput, root: Element): LayoutNode {
  const make = (el: Element): LayoutNode => ({
    id: el.id,
    width: widthOf(el),
    height: input.height(el),
    shape: el.shape,
    beside: displayOf(el) === "function_connector",
    first: null,
    others: [],
  });
  const top = make(root);
  // Iterative: a long column is thousands of levels deep.
  const stack: Array<[Element, LayoutNode]> = [[root, top]];
  while (stack.length) {
    const [el, node] = stack.pop()!;
    const kids = children(input.graph, el.id).filter(input.visible);
    const first = firstChild(input.graph, el.id, input.visible);
    const textLength = el.text?.length ?? 0;
    for (const c of kids) {
      const n = make(c);
      if (c.anchor && textLength > 0) n.anchorAt = c.anchor.start / textLength;
      if (c.id === first?.id) node.first = n;
      else node.others.push(n);
      stack.push([c, n]);
    }
  }
  return top;
}

/** The origin edge of each tree: its element with no parent. */
export function originOf(graph: CanvasGraph, tree: Tree, elements: Iterable<Element>): Element | undefined {
  for (const el of elements) if (el.treeId === tree.id && el.parentId === null) return element(graph, el.id);
  return undefined;
}

/**
 * Lays out each tree on its own, placed at its persisted origin. Only trees in `changedTreeIds` are
 * recomputed. If a changed tree now overlaps another tree, only the changed tree moves; every other
 * tree keeps its exact positions, and a tree the user placed never moves (FR-036, FR-038, SC-009).
 * Hand-placed elements override only their own position (FR-037).
 */
export function layoutForest(
  input: LayoutInput,
  trees: Tree[],
  origins: Map<string, Element>,
  changedTreeIds: Set<string>,
  cache: LayoutCache,
): ForestLayout {
  const at = new Map(trees.map((t) => [t.id, { ...t.origin }]));
  for (const t of trees) {
    const origin = origins.get(t.id);
    if (!origin) {
      cache.delete(t.id);
      continue;
    }
    if (!cache.has(t.id) || changedTreeIds.has(t.id)) cache.set(t.id, layoutTree(layoutModel(input, origin)));
  }

  const placed = new Map<string, Box>();
  const relocations: ForestLayout["relocations"] = [];
  // Unchanged and user-placed trees are fixed; place them first, then fit the rest around them.
  const movable = (t: Tree) => changedTreeIds.has(t.id) && !t.userPlaced;
  const ordered = trees.filter((t) => cache.has(t.id)).sort((a, b) => Number(movable(a)) - Number(movable(b)));
  for (const t of ordered) {
    const layout = cache.get(t.id)!;
    let origin = at.get(t.id)!;
    let box = offset(layout.box, origin.x, origin.y);
    if (movable(t) && [...placed.values()].some((other) => overlaps(box, other))) {
      const rightmost = Math.max(...[...placed.values()].map((b) => b.maxX));
      origin = { x: rightmost + TREE_GAP - layout.box.minX, y: origin.y };
      box = offset(layout.box, origin.x, origin.y);
      at.set(t.id, origin);
      relocations.push({ treeId: t.id, ...origin });
    }
    placed.set(t.id, box);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const t of ordered) {
    const origin = at.get(t.id)!;
    for (const [id, p] of cache.get(t.id)!.positions) {
      const manual = element(input.graph, id)?.manual;
      positions.set(id, manual ? { x: manual.x + origin.x, y: manual.y + origin.y } : { x: p.x + origin.x, y: p.y + origin.y });
    }
  }
  return { positions, boxes: placed, relocations };
}
