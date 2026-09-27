import { DirectedGraph } from "graphology";
import type { ForestResponse, MapNode, Summary } from "@/shared/schemas";

export type NodeAttrs = { treeId: string; isRoot: boolean; summary: Summary; createdAt: string };
export type ForestGraph = DirectedGraph<NodeAttrs>;

/** Structure of the forest, independent of rendering (research R4). Edges run parent → child. */
export function buildForestGraph(forest: ForestResponse): ForestGraph {
  const graph: ForestGraph = new DirectedGraph<NodeAttrs>();
  for (const n of forest.nodes) {
    graph.addNode(n.id, { treeId: n.treeId, isRoot: n.isRoot, summary: n.summary, createdAt: n.createdAt });
  }
  for (const n of forest.nodes) {
    if (n.parentId && graph.hasNode(n.parentId)) graph.addDirectedEdge(n.parentId, n.id);
  }
  return graph;
}

export type ForestDiff = {
  addedNodes: MapNode[];
  changedSummaries: Array<{ id: string; summary: Summary }>;
  changedTreeIds: Set<string>;
};

const sameSummary = (a: Summary, b: Summary) =>
  a.kind === b.kind && a.text === b.text && (a.kind !== "summary" || b.kind !== "summary" || a.createdAt === b.createdAt);

export function diffForest(prev: ForestResponse | null, next: ForestResponse): ForestDiff {
  const before = new Map(prev?.nodes.map((n) => [n.id, n]));
  const diff: ForestDiff = { addedNodes: [], changedSummaries: [], changedTreeIds: new Set() };
  for (const n of next.nodes) {
    const old = before.get(n.id);
    if (!old) {
      diff.addedNodes.push(n);
      diff.changedTreeIds.add(n.treeId);
    } else if (!sameSummary(old.summary, n.summary)) {
      diff.changedSummaries.push({ id: n.id, summary: n.summary });
    }
  }
  return diff;
}
