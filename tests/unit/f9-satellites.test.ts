import { describe, expect, it } from "vitest";
import type { ForestResponse, MapNode } from "@/shared/schemas";
import { buildForestGraph } from "@/map/forestGraph";
import { layoutForest, type LayoutCache } from "@/map/layout/forestLayout";
import { layoutTree, NODE_HEIGHT, NODE_WIDTH, SATELLITE_GAP } from "@/map/layout/treeLayout";

let clock = 0;
function node(id: string, treeId: string, parentId: string | null, manual: MapNode["manual"] = null): MapNode {
  return {
    id,
    treeId,
    parentId,
    isRoot: parentId === null,
    anchorText: parentId ? "x" : null,
    summary: { kind: "placeholder", text: id },
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString(),
    manual,
    edgeLabel: null,
    messageCount: 0,
    kind: "conversation",
    origin: parentId ? "branch" : "root",
    output: null,
  };
}

function output(id: string, treeId: string, inputNodeId: string, manual: MapNode["manual"] = null): MapNode {
  return {
    ...node(id, treeId, null, manual),
    isRoot: false,
    kind: "analogy",
    origin: "function",
    summary: { kind: "placeholder", text: "" },
    output: {
      functionId: "analogy",
      pipeId: `p-${id}`,
      inputNodeId,
      displayedText: "Like a library.",
      provenance: "ai_suggested",
      review: "proposed",
      stale: false,
      pendingDraft: false,
      versionCount: 1,
    },
  };
}

function forest(nodes: MapNode[], trees: Array<{ id: string; root: string; x: number; userPlaced?: boolean }>): ForestResponse {
  return {
    nodes,
    pipes: [],
    trees: trees.map((t) => ({ id: t.id, rootNodeId: t.root, origin: { x: t.x, y: 0 }, userPlaced: t.userPlaced ?? false })),
  };
}

const overlap = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) < NODE_WIDTH && Math.abs(a.y - b.y) < NODE_HEIGHT;

describe("Feature 9 · output placement (FR-039)", () => {
  const convo = [node("r", "t", null), node("a", "t", "r"), node("b", "t", "r")];

  it("places an output right of its input and stacks a second one below", () => {
    const g = buildForestGraph(forest([...convo, output("o1", "t", "a"), output("o2", "t", "a")], [{ id: "t", root: "r", x: 0 }]));
    const { positions } = layoutTree(g, "r");
    const a = positions.get("a")!;
    const o1 = positions.get("o1")!;
    const o2 = positions.get("o2")!;
    expect(o1.x).toBeGreaterThanOrEqual(a.x + NODE_WIDTH + SATELLITE_GAP);
    expect(o2.x).toBeGreaterThanOrEqual(a.x + NODE_WIDTH + SATELLITE_GAP);
    expect(o2.y).toBeGreaterThan(o1.y);
  });

  it("never overlaps a node in its tree", () => {
    // "a" sits left of "b", so an output of "a" must step past "b".
    const g = buildForestGraph(forest([...convo, output("o1", "t", "a")], [{ id: "t", root: "r", x: 0 }]));
    const { positions } = layoutTree(g, "r");
    for (const id of ["r", "a", "b"]) expect(overlap(positions.get("o1")!, positions.get(id)!)).toBe(false);
  });

  it("keeps a hand-placed output where it was put", () => {
    const g = buildForestGraph(forest([...convo, output("o1", "t", "a", { x: -500, y: 300 })], [{ id: "t", root: "r", x: 0 }]));
    expect(layoutTree(g, "r").positions.get("o1")).toEqual({ x: -500, y: 300 });
  });

  it("doesn't move conversation nodes, other trees or user-placed trees", () => {
    const base = forest([...convo, node("r2", "t2", null), node("r3", "t3", null)], [
      { id: "t", root: "r", x: 0 },
      { id: "t2", root: "r2", x: 900 },
      { id: "t3", root: "r3", x: 1800, userPlaced: true },
    ]);
    const withOutput = { ...base, nodes: [...base.nodes, output("o1", "t", "b")] };
    const before = layoutForest(buildForestGraph(base), base.trees, new Set(), new Map() as LayoutCache);
    const after = layoutForest(buildForestGraph(withOutput), withOutput.trees, new Set(["t"]), new Map() as LayoutCache);
    for (const id of ["r", "a", "b", "r2", "r3"]) expect(after.positions.get(id)).toEqual(before.positions.get(id));
    expect(after.relocations.map((r) => r.treeId)).not.toContain("t2");
    expect(after.relocations.map((r) => r.treeId)).not.toContain("t3");
  });
});
