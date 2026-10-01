import { hierarchy, tree } from "d3-hierarchy";
import type { ForestGraph } from "../forestGraph";

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 64;
const NODE_SIZE: [number, number] = [220, 120];
/** Horizontal space between a function output and the box it sits beside (Feature 9). */
export const SATELLITE_GAP = 40;
/** Vertical space between outputs stacked beside the same input. */
const SATELLITE_STACK_GAP = 24;
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
  const placed: Box[] = [];
  const place = (id: string, p: { x: number; y: number }) => {
    positions.set(id, p);
    const b = boxAt(p, heightOf(id));
    placed.push(b);
    box.minX = Math.min(box.minX, b.minX);
    box.maxX = Math.max(box.maxX, b.maxX);
    box.minY = Math.min(box.minY, b.minY);
    box.maxY = Math.max(box.maxY, b.maxY);
  };
  root.each((n) => {
    // A hand-placed node keeps the position the user gave it (Feature 2, FR-016, FR-019).
    const manual = n.depth > 0 ? graph.getNodeAttribute(n.data.id, "manual") : null;
    place(n.data.id, manual ?? { x: n.x, y: levelY[n.depth] });
  });
  placeSatellites(graph, rootId, positions, placed, heightOf, place);
  return { positions, box };
}

const boxAt = (p: { x: number; y: number }, height: number): Box => ({
  minX: p.x - NODE_WIDTH / 2,
  maxX: p.x + NODE_WIDTH / 2,
  minY: p.y - NODE_HEIGHT / 2,
  maxY: p.y - NODE_HEIGHT / 2 + height,
});

const collides = (a: Box, b: Box) =>
  a.minX < b.maxX + SATELLITE_STACK_GAP &&
  a.maxX + SATELLITE_STACK_GAP > b.minX &&
  a.minY < b.maxY + SATELLITE_STACK_GAP &&
  a.maxY + SATELLITE_STACK_GAP > b.minY;

/**
 * Function outputs aren't children, so the tidy tree doesn't place them. Each sits to the right of
 * its input, later ones stacked below earlier ones, stepping right until it overlaps nothing in the
 * tree (Feature 9, research R11). Hand-placed outputs keep their position (FR-039).
 */
function placeSatellites(
  graph: ForestGraph,
  rootId: string,
  positions: Map<string, { x: number; y: number }>,
  placed: Box[],
  heightOf: (id: string) => number,
  place: (id: string, p: { x: number; y: number }) => void,
): void {
  const treeId = graph.getNodeAttribute(rootId, "treeId");
  const outputs = graph
    .filterNodes((_id, a) => a.treeId === treeId && a.output !== null)
    .sort((a, b) => graph.getNodeAttribute(a, "createdAt").localeCompare(graph.getNodeAttribute(b, "createdAt")) || a.localeCompare(b));
  const stacked = new Map<string, number>();
  for (const id of outputs) {
    const inputId = graph.getNodeAttribute(id, "output")!.inputNodeId;
    const input = positions.get(inputId);
    if (!input) continue;
    const manual = graph.getNodeAttribute(id, "manual");
    if (manual) {
      place(id, manual);
      continue;
    }
    const below = stacked.get(inputId) ?? 0;
    stacked.set(inputId, below + heightOf(id) + SATELLITE_STACK_GAP);
    const p = { x: input.x + NODE_WIDTH + SATELLITE_GAP, y: input.y + below };
    while (placed.some((b) => collides(boxAt(p, heightOf(id)), b))) p.x += NODE_WIDTH + SATELLITE_GAP;
    place(id, p);
  }
}
