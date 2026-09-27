import type { MapTree } from "@/shared/schemas";
import type { ForestGraph } from "../forestGraph";
import { type Box, layoutTree, type TreeLayout } from "./treeLayout";

export const TREE_GAP = 80;

export type ForestLayout = {
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

/**
 * Lays out each tree on its own (per connected component), placed at its persisted origin.
 * Only trees in `changedTreeIds` are recomputed. If a changed tree now overlaps another tree,
 * only the changed tree moves; every other tree keeps its exact positions (FR-023, SC-007).
 */
export function layoutForest(
  graph: ForestGraph,
  trees: MapTree[],
  changedTreeIds: Set<string>,
  cache: LayoutCache,
  heights: ReadonlyMap<string, number> = new Map(),
): ForestLayout {
  const origins = new Map(trees.map((t) => [t.id, { ...t.origin }]));
  for (const t of trees) {
    if (!cache.has(t.id) || changedTreeIds.has(t.id)) cache.set(t.id, layoutTree(graph, t.rootNodeId, heights));
  }

  const placed = new Map<string, Box>();
  const relocations: ForestLayout["relocations"] = [];
  // Unchanged and user-placed trees are fixed; place them first, then fit the rest around them.
  const movable = (t: MapTree) => changedTreeIds.has(t.id) && !t.userPlaced;
  const ordered = [...trees].sort((a, b) => Number(movable(a)) - Number(movable(b)));
  for (const t of ordered) {
    const layout = cache.get(t.id)!;
    let origin = origins.get(t.id)!;
    let box = offset(layout.box, origin.x, origin.y);
    // A tree the user placed is never moved automatically (Feature 2, FR-020).
    if (!t.userPlaced && changedTreeIds.has(t.id) && [...placed.values()].some((other) => overlaps(box, other))) {
      const rightmost = Math.max(...[...placed.values()].map((b) => b.maxX));
      origin = { x: rightmost + TREE_GAP - layout.box.minX, y: 0 };
      box = offset(layout.box, origin.x, origin.y);
      origins.set(t.id, origin);
      relocations.push({ treeId: t.id, ...origin });
    }
    placed.set(t.id, box);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const t of trees) {
    const origin = origins.get(t.id)!;
    for (const [id, p] of cache.get(t.id)!.positions) positions.set(id, { x: p.x + origin.x, y: p.y + origin.y });
  }
  return { positions, boxes: placed, relocations };
}
