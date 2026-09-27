import { hierarchy, tree } from "d3-hierarchy";
import type { ForestGraph } from "../forestGraph";

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 64;
const NODE_SIZE: [number, number] = [220, 120];

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
export function layoutTree(graph: ForestGraph, rootId: string): TreeLayout {
  const root = tree<HNode>().nodeSize(NODE_SIZE)(hierarchy(toHierarchy(graph, rootId)));
  const positions = new Map<string, { x: number; y: number }>();
  const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  root.each((n) => {
    positions.set(n.data.id, { x: n.x, y: n.y });
    box.minX = Math.min(box.minX, n.x - NODE_WIDTH / 2);
    box.maxX = Math.max(box.maxX, n.x + NODE_WIDTH / 2);
    box.minY = Math.min(box.minY, n.y - NODE_HEIGHT / 2);
    box.maxY = Math.max(box.maxY, n.y + NODE_HEIGHT / 2);
  });
  return { positions, box };
}
