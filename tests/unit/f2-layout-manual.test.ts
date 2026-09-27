import { describe, expect, it } from "vitest";
import type { ForestResponse, MapNode } from "@/shared/schemas";
import { buildForestGraph } from "@/map/forestGraph";
import { layoutForest, type LayoutCache } from "@/map/layout/forestLayout";
import { layoutTree } from "@/map/layout/treeLayout";

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
  };
}

function forest(nodes: MapNode[], trees: Array<{ id: string; x: number; userPlaced?: boolean }>): ForestResponse {
  return {
    nodes,
    trees: trees.map((t) => ({
      id: t.id,
      rootNodeId: nodes.find((n) => n.treeId === t.id && n.parentId === null)!.id,
      origin: { x: t.x, y: 0 },
      userPlaced: t.userPlaced ?? false,
    })),
  };
}

describe("hand-placed nodes", () => {
  it("override the tidy position of that node only, and the box includes them", () => {
    const tidy = layoutTree(buildForestGraph(forest([node("r", "t", null), node("a", "t", "r"), node("b", "t", "r")], [{ id: "t", x: 0 }])), "r");
    const placed = layoutTree(
      buildForestGraph(forest([node("r", "t", null), node("a", "t", "r", { x: 900, y: 700 }), node("b", "t", "r")], [{ id: "t", x: 0 }])),
      "r",
    );
    expect(placed.positions.get("a")).toEqual({ x: 900, y: 700 });
    expect(placed.positions.get("b")).toEqual(tidy.positions.get("b"));
    expect(placed.box.maxX).toBeGreaterThanOrEqual(900);
    expect(placed.box.maxY).toBeGreaterThanOrEqual(700);
  });

  it("keep their position when the tree grows", () => {
    const f1 = forest([node("r", "t", null), node("a", "t", "r", { x: -500, y: 300 })], [{ id: "t", x: 0 }]);
    const f2 = forest([...f1.nodes, node("c", "t", "r"), node("d", "t", "c")], [{ id: "t", x: 0 }]);
    expect(layoutTree(buildForestGraph(f2), "r").positions.get("a")).toEqual({ x: -500, y: 300 });
  });
});

describe("user-placed trees", () => {
  it("are never relocated, and an auto-placed tree moves away from them instead", () => {
    const wide = [node("r1", "t1", null)];
    for (let i = 0; i < 12; i++) wide.push(node(`w${i}`, "t1", "r1"));
    const small = [node("r2", "t2", null)];

    const userPlaced = forest([...wide, ...small], [{ id: "t1", x: 0, userPlaced: true }, { id: "t2", x: 300 }]);
    const a = layoutForest(buildForestGraph(userPlaced), userPlaced.trees, new Set(["t1", "t2"]), new Map() as LayoutCache);
    expect(a.relocations.map((r) => r.treeId)).toEqual(["t2"]);

    const bothUser = forest([...wide, ...small], [{ id: "t1", x: 0, userPlaced: true }, { id: "t2", x: 300, userPlaced: true }]);
    const b = layoutForest(buildForestGraph(bothUser), bothUser.trees, new Set(["t1", "t2"]), new Map() as LayoutCache);
    expect(b.relocations).toEqual([]); // overlap is the user's choice
  });
});
