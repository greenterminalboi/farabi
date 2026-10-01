import { DirectedGraph } from "graphology";
import type { ForestResponse, MapNode, OutputSummary, Summary } from "@/shared/schemas";

export type NodeAttrs = {
  treeId: string;
  isRoot: boolean;
  summary: Summary;
  createdAt: string;
  /** Hand-placed position relative to the tree origin (Feature 2). */
  manual: { x: number; y: number } | null;
  edgeLabel: string | null;
  /** Node kind (Feature 9). Only conversations take part in parent → child edges. */
  kind: string;
  /** Set for function outputs; they are placed beside `output.inputNodeId`. */
  output: OutputSummary | null;
};
export type ForestGraph = DirectedGraph<NodeAttrs>;

/** Structure of the forest, independent of rendering (research R4). Edges run parent → child. */
export function buildForestGraph(forest: ForestResponse): ForestGraph {
  const graph: ForestGraph = new DirectedGraph<NodeAttrs>();
  for (const n of forest.nodes) {
    graph.addNode(n.id, {
      treeId: n.treeId,
      isRoot: n.isRoot,
      summary: n.summary,
      createdAt: n.createdAt,
      manual: n.manual,
      edgeLabel: n.edgeLabel,
      kind: n.kind,
      output: n.output,
    });
  }
  for (const n of forest.nodes) {
    if (n.parentId && graph.hasNode(n.parentId)) graph.addDirectedEdge(n.parentId, n.id);
  }
  return graph;
}

export type ForestDiff = {
  addedNodes: MapNode[];
  changedSummaries: Array<{ id: string; summary: Summary }>;
  /** Function outputs whose text, review or badges changed (Feature 9); redrawn in place. */
  changedOutputs: MapNode[];
  /** A pipe was added or changed state (Feature 9). */
  pipesChanged: boolean;
  changedTreeIds: Set<string>;
  /** Edge labels changed (Feature 2); needs a redraw but no re-layout. */
  labelsChanged: boolean;
};

const sameSummary = (a: Summary, b: Summary) =>
  a.kind === b.kind && a.text === b.text && (a.kind !== "summary" || b.kind !== "summary" || a.createdAt === b.createdAt);

const sameOutput = (a: OutputSummary | null, b: OutputSummary | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.displayedText === b.displayedText &&
    a.review === b.review &&
    a.stale === b.stale &&
    a.pendingDraft === b.pendingDraft);

/**
 * Deep conversations are drawn as a stack of cards behind the node: none for shallow ones, one or
 * two for deeper ones. Counted in exchanges (a message and its reply).
 */
export const STACK_EXCHANGES = [4, 10];

export function stackLayers(messageCount: number): number {
  const exchanges = Math.floor(messageCount / 2);
  return STACK_EXCHANGES.filter((n) => exchanges >= n).length;
}

export function diffForest(prev: ForestResponse | null, next: ForestResponse): ForestDiff {
  const before = new Map(prev?.nodes.map((n) => [n.id, n]));
  const diff: ForestDiff = {
    addedNodes: [],
    changedSummaries: [],
    changedOutputs: [],
    pipesChanged: false,
    changedTreeIds: new Set(),
    labelsChanged: false,
  };
  for (const n of next.nodes) {
    const old = before.get(n.id);
    if (!old) {
      diff.addedNodes.push(n);
      diff.changedTreeIds.add(n.treeId);
    } else {
      if (!sameSummary(old.summary, n.summary)) diff.changedSummaries.push({ id: n.id, summary: n.summary });
      if (!sameOutput(old.output, n.output)) {
        // Text, review and badges change the box: redraw that tree.
        diff.changedOutputs.push(n);
        diff.changedTreeIds.add(n.treeId);
      }
      if (old.manual?.x !== n.manual?.x || old.manual?.y !== n.manual?.y) diff.changedTreeIds.add(n.treeId);
      if (old.edgeLabel !== n.edgeLabel) diff.labelsChanged = true;
      // A conversation that got deep enough to show another card is redrawn.
      if (stackLayers(old.messageCount) !== stackLayers(n.messageCount)) diff.changedTreeIds.add(n.treeId);
    }
  }
  const prevPipes = new Map(prev?.pipes.map((p) => [p.id, p]));
  for (const p of next.pipes) {
    const old = prevPipes.get(p.id);
    if (!old || old.state !== p.state) {
      diff.pipesChanged = true;
      diff.changedTreeIds.add(p.treeId);
    }
  }
  const prevTrees = new Map(prev?.trees.map((t) => [t.id, t]));
  for (const t of next.trees) {
    const old = prevTrees.get(t.id);
    if (old && (old.origin.x !== t.origin.x || old.origin.y !== t.origin.y)) diff.changedTreeIds.add(t.id);
  }
  return diff;
}
