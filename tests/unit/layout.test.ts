import { describe, expect, it } from "vitest";
import type { ForestResponse, MapNode } from "@/shared/schemas";
import { buildForestGraph } from "@/map/forestGraph";
import { layoutForest, type LayoutCache } from "@/map/layout/forestLayout";
import { layoutTree } from "@/map/layout/treeLayout";

let clock = 0;
function node(id: string, treeId: string, parentId: string | null): MapNode {
  return {
    id,
    treeId,
    parentId,
    isRoot: parentId === null,
    anchorText: parentId ? "x" : null,
    summary: { kind: "placeholder", text: id },
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString(),
  };
}

function forest(nodes: MapNode[], origins: Record<string, number>): ForestResponse {
  const trees = Object.entries(origins).map(([id, x]) => ({
    id,
    rootNodeId: nodes.find((n) => n.treeId === id && n.parentId === null)!.id,
    origin: { x, y: 0 },
  }));
  return { trees, nodes };
}

describe("layoutTree", () => {
  it("is deterministic", () => {
    const f = forest([node("r", "t", null), node("a", "t", "r"), node("b", "t", "r")], { t: 0 });
    const g = buildForestGraph(f);
    expect([...layoutTree(g, "r").positions]).toEqual([...layoutTree(g, "r").positions]);
  });
});

describe("layoutForest", () => {
  it("recomputes only changed trees and keeps other trees fixed", () => {
    const base = [node("r1", "t1", null), node("a", "t1", "r1"), node("r2", "t2", null), node("b", "t2", "r2")];
    const f1 = forest(base, { t1: 0, t2: 2000 });
    const cache: LayoutCache = new Map();
    const before = layoutForest(buildForestGraph(f1), f1.trees, new Set(["t1", "t2"]), cache);
    const cachedT2 = cache.get("t2");

    const f2 = forest([...base, node("c", "t1", "r1")], { t1: 0, t2: 2000 });
    const after = layoutForest(buildForestGraph(f2), f2.trees, new Set(["t1"]), cache);
    expect(cache.get("t2")).toBe(cachedT2);
    for (const id of ["r2", "b"]) expect(after.positions.get(id)).toEqual(before.positions.get(id));
    expect(after.relocations).toEqual([]);
  });

  it("relocates only the growing tree when it would overlap a neighbour (SC-007)", () => {
    const t1 = [node("r1", "t1", null)];
    // Tree 1 grows wide: 12 children under its root.
    for (let i = 0; i < 12; i++) t1.push(node(`c${i}`, "t1", "r1"));
    const t2 = [node("r2", "t2", null), node("d", "t2", "r2")];
    const f = forest([...t1, ...t2], { t1: 0, t2: 600 });
    const cache: LayoutCache = new Map();
    // First lay out t2 alone as unchanged, then t1 grows.
    layoutForest(buildForestGraph(f), f.trees, new Set(["t2"]), cache);
    const t2Before = new Map([...cache.get("t2")!.positions].map(([id, p]) => [id, { x: p.x + 600, y: p.y }]));

    const after = layoutForest(buildForestGraph(f), f.trees, new Set(["t1"]), cache);
    expect(after.relocations.map((r) => r.treeId)).toEqual(["t1"]);
    for (const [id, p] of t2Before) expect(after.positions.get(id)).toEqual(p);

    const b1 = after.boxes.get("t1")!;
    const b2 = after.boxes.get("t2")!;
    const disjoint = b1.maxX <= b2.minX || b2.maxX <= b1.minX || b1.maxY <= b2.minY || b2.maxY <= b1.minY;
    expect(disjoint).toBe(true);
  });
});
