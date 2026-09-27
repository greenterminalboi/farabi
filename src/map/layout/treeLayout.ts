import { hierarchy, tree } from "d3-hierarchy";
import type { ForestGraph } from "../forestGraph";

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 64;
const NODE_SIZE: [number, number] = [220, 120];
/** Vertical space between the bottom of one level's tallest box and the next level. */
export const LEVEL_GAP = NODE_SIZE[1] - NODE_HEIGHT;

export type Box = { minX: number; minY: number; maxX: number; maxY: number };
export type TreeLayout = { positions: Map<string, { x: number; y: number }>; box: Box };

type HNode = { id: string; children: HNode[] };

function toHierarchy(graph: ForestGraph, id: string): HNode {
  const children = graph
    .outNeighbors(id)
    .sort((a, b) => graph.getNodeAttribute(a, "createdAt").localeCompare(graph.getNodeAttribute(b, "createdAt")) || a.localeCompare(b))
    .map((child) => toHierarchy(graph, child));
  return { id, children };
}

/** Tidy-tree (Reingold–Tilford) layout of one tree, relative to its root at (0, 0). */
/**
 * Tidy-tree (Reingold–Tilford) layout of one tree, relative to its root at (0, 0). Boxes grow to
 * fit their text, so each level starts below the tallest box of the level above (`heights`).
 */
export function layoutTree(
  graph: ForestGraph,
  rootId: string,
  heights: ReadonlyMap<string, number> = new Map(),
): TreeLayout {
  const root = tree<HNode>().nodeSize(NODE_SIZE)(hierarchy(toHierarchy(graph, rootId)));
  const heightOf = (id: string) => heights.get(id) ?? NODE_HEIGHT;

  const levelHeight: number[] = [];
  root.each((n) => (levelHeight[n.depth] = Math.max(levelHeight[n.depth] ?? 0, heightOf(n.data.id))));
  const levelY: number[] = [0];
  for (let d = 1; d < levelHeight.length; d++) levelY[d] = levelY[d - 1] + levelHeight[d - 1] + LEVEL_GAP;

  const positions = new Map<string, { x: number; y: number }>();
  const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  root.each((n) => {
    // A hand-placed node keeps the position the user gave it (Feature 2, FR-016, FR-019).
    const manual = n.depth > 0 ? graph.getNodeAttribute(n.data.id, "manual") : null;
    const p = manual ?? { x: n.x, y: levelY[n.depth] };
    positions.set(n.data.id, p);
    box.minX = Math.min(box.minX, p.x - NODE_WIDTH / 2);
    box.maxX = Math.max(box.maxX, p.x + NODE_WIDTH / 2);
    box.minY = Math.min(box.minY, p.y - NODE_HEIGHT / 2);
    box.maxY = Math.max(box.maxY, p.y - NODE_HEIGHT / 2 + heightOf(n.data.id));
  });
  return { positions, box };
}
