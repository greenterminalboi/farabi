import { describe, expect, it } from "vitest";
import { buildGraph, mergeGraph } from "@/canvas/graph";
import { type LayoutCache, type LayoutInput, layoutForest } from "@/canvas/layout/forestLayout";
import { GAP_TO_ANSWER, GAP_TO_QUESTION, SIBLING_GAP } from "@/canvas/layout/treeLayout";
import { WIDTH } from "@/canvas/geometry";
import type { Element, Tree } from "@/shared/schemas";

// Feature 10 layout (research R10; FR-036–FR-039; SC-009).

let clock = 0;
function el(id: string, kind: string, parentId: string | null, treeId = "t1", extra: Partial<Element> = {}): Element {
  const shape = kind === "question" || kind === "function" ? "edge" : "node";
  return {
    id,
    treeId,
    parentId,
    kind,
    shape,
    origin: parentId ? (kind === "answer" ? "reply" : kind === "analogy" ? "run" : kind === "function" ? "run" : "ask") : "origin",
    provenance: kind === "question" ? "user_authored" : "ai_suggested",
    text: kind === "function" ? null : `text of ${id}`,
    createdAt: new Date(Date.UTC(2026, 9, 7, 0, 0, clock++)).toISOString(),
    manual: null,
    ...(kind === "answer" ? { status: "complete" as const } : {}),
    ...extra,
  };
}

const tree = (id: string, x = 0, y = 0, userPlaced = false): Tree => ({ id, origin: { x, y }, userPlaced, rootAnswerId: null });

function setup(elements: Element[], heights: Record<string, number> = {}) {
  const graph = buildGraph(elements);
  const input: LayoutInput = {
    graph,
    visible: (e) => e.review !== "rejected",
    height: (e) => heights[e.id] ?? (e.kind === "function" ? 0 : e.kind === "question" ? 46 : 120),
  };
  return { graph, input };
}

function run(elements: Element[], trees: Tree[], opts: { heights?: Record<string, number>; cache?: LayoutCache; changed?: string[] } = {}) {
  const { graph, input } = setup(elements, opts.heights);
  const origins = new Map(trees.map((t) => [t.id, elements.find((e) => e.treeId === t.id && e.parentId === null)!]));
  const cache = opts.cache ?? new Map();
  const changed = new Set(opts.changed ?? trees.map((t) => t.id));
  return { graph, input, origins, cache, layout: layoutForest(input, trees, origins, changed, cache) };
}

/** q0 → a0 → q1 → a1 → q2 → a2: one run. */
function column(prefix = "", treeId = "t1"): Element[] {
  const out: Element[] = [];
  let parent: string | null = null;
  for (let i = 0; i < 3; i++) {
    const q = el(`${prefix}q${i}`, "question", parent, treeId);
    const a = el(`${prefix}a${i}`, "answer", q.id, treeId);
    out.push(q, a);
    parent = a.id;
  }
  return out;
}

const centre = (p: { x: number }, kind: "answer" | "question") => p.x + WIDTH[kind] / 2;
type Rect = { x: number; y: number; w: number; h: number };
const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("Feature 10 · tree layout", () => {
  it("lays a 6-element run out as one centred column, top to bottom", () => {
    const { layout } = run(column(), [tree("t1")]);
    const p = (id: string) => layout.positions.get(id)!;
    expect(p("q0")).toEqual({ x: 0, y: 0 });
    for (const [q, a] of [["q0", "a0"], ["q1", "a1"], ["q2", "a2"]]) {
      expect(centre(p(q), "question")).toBe(centre(p("q0"), "question"));
      expect(centre(p(a), "answer")).toBe(centre(p("q0"), "question"));
      expect(p(a).y).toBe(p(q).y + 46 + GAP_TO_ANSWER);
    }
    expect(p("q1").y).toBe(p("a0").y + 120 + GAP_TO_QUESTION);
  });

  it("puts a sibling edge to the right and never moves the column", () => {
    const base = column();
    const before = run(base, [tree("t1")]).layout.positions;
    const sibling = el("qs", "question", "a0");
    const after = run([...base, sibling, el("as", "answer", "qs")], [tree("t1")]).layout.positions;
    for (const e of base) expect(after.get(e.id)).toEqual(before.get(e.id));
    expect(after.get("qs")!.x).toBeGreaterThanOrEqual(before.get("a0")!.x + WIDTH.answer + SIBLING_GAP - 1);
    expect(after.get("qs")!.y).toBe(after.get("q1")!.y);
  });

  it("never overlaps boxes in a deep fan-out", () => {
    const els: Element[] = [el("q", "question", null), el("a", "answer", "q")];
    // Three levels, three children each, with uneven heights.
    const heights: Record<string, number> = {};
    let n = 0;
    const grow = (parent: string, depth: number) => {
      if (depth === 0) return;
      for (let i = 0; i < 3; i++) {
        const q = el(`q${n}`, "question", parent);
        const a = el(`a${n++}`, "answer", q.id);
        heights[a.id] = 60 + ((n * 37) % 300);
        els.push(q, a);
        grow(a.id, depth - 1);
      }
    };
    grow("a", 3);
    const { layout, input } = run(els, [tree("t1")], { heights });
    const rects = els.map((e) => ({ ...layout.positions.get(e.id)!, w: WIDTH[e.kind as "answer" | "question"], h: input.height(e) }));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) expect(intersects(rects[i], rects[j]), `${els[i].id} × ${els[j].id}`).toBe(false);
    }
  });

  it("places an anchored branch at its span's height, and function outputs beside their input", () => {
    const branch = el("qb", "question", "a0", "t1", { anchor: { start: 50, end: 60, text: "x", prefix: "", suffix: "" } });
    const a0text = "y".repeat(100);
    const els = column().map((e) => (e.id === "a0" ? { ...e, text: a0text } : e));
    const fn = el("f", "function", "a0");
    const out = el("o", "analogy", "f");
    const { layout } = run([...els, branch, fn, out], [tree("t1")], { heights: { a0: 200 } });
    const p = (id: string) => layout.positions.get(id)!;
    expect(p("qb").y).toBe(p("a0").y + 100);
    expect(p("f").y).toBe(p("a0").y);
    expect(p("o").y).toBeGreaterThan(p("f").y);
    expect(p("o").x).toBeGreaterThan(p("a0").x + WIDTH.answer);
  });

  it("moves only a hand-placed element, keeping its children laid out from the computed spot", () => {
    const base = column();
    const before = run(base, [tree("t1", 100, 50)]).layout.positions;
    const placed = base.map((e) => (e.id === "a0" ? { ...e, manual: { x: -500, y: 900 } } : e));
    const after = run(placed, [tree("t1", 100, 50)]).layout.positions;
    expect(after.get("a0")).toEqual({ x: -400, y: 950 });
    for (const e of base.filter((x) => x.id !== "a0")) expect(after.get(e.id)).toEqual(before.get(e.id));
  });

  it("adding to one tree moves no other tree and no hand-placed element (SC-009)", () => {
    const one = column("x", "t1");
    const two = column("y", "t2").map((e) => (e.id === "ya1" ? { ...e, manual: { x: 40, y: 40 } } : e));
    const trees = [tree("t1", 0, 0), tree("t2", 3000, 0)];
    const first = run([...one, ...two], trees);
    const grown = [...one, ...two, el("xq3", "question", "xa2", "t1"), el("xa3", "answer", "xq3", "t1", { text: "z".repeat(4000) })];
    const { graph, input, origins } = first;
    mergeGraph(graph, grown);
    const second = layoutForest(input, trees, origins, new Set(["t1"]), first.cache);
    for (const e of two) expect(second.positions.get(e.id)).toEqual(first.layout.positions.get(e.id));
    expect(second.positions.get("ya1")).toEqual({ x: 3040, y: 40 });
  });

  it("relocates a changed tree that would overlap, but never a user-placed one", () => {
    const one = column("x", "t1");
    const two = column("y", "t2");
    const close = [tree("t1", 0, 0), tree("t2", 100, 0)];
    const moved = run([...one, ...two], close, { changed: ["t2"] });
    expect(moved.layout.relocations.map((r) => r.treeId)).toEqual(["t2"]);
    const pinned = run([...one, ...two], [tree("t1", 0, 0), tree("t2", 100, 0, true)], { changed: ["t2"] });
    expect(pinned.layout.relocations).toEqual([]);
  });

  it("a streaming height change moves only later elements of the same column", () => {
    const base = [...column(), el("qs", "question", "a0"), el("as", "answer", "qs")];
    const short = run(base, [tree("t1")], { heights: { a1: 100 } }).layout.positions;
    const tall = run(base, [tree("t1")], { heights: { a1: 600 } }).layout.positions;
    for (const id of ["q0", "a0", "q1", "a1", "qs", "as"]) expect(tall.get(id)).toEqual(short.get(id));
    expect(tall.get("q2")!.y - short.get("q2")!.y).toBe(500);
    expect(tall.get("a2")!.y - short.get("a2")!.y).toBe(500);
  });

  it("leaves rejected outputs out of the layout", () => {
    const els = [...column(), el("f", "function", "a0"), el("o", "analogy", "f", "t1", { review: "rejected" })];
    const { layout } = run(els, [tree("t1")]);
    expect(layout.positions.has("o")).toBe(false);
  });

  it("lays out a 5,000-element column quickly", () => {
    const els: Element[] = [];
    let parent: string | null = null;
    for (let i = 0; i < 2500; i++) {
      const q = el(`q${i}`, "question", parent);
      const a = el(`a${i}`, "answer", q.id);
      els.push(q, a);
      parent = a.id;
    }
    const started = performance.now();
    const { layout } = run(els, [tree("t1")]);
    expect(layout.positions.size).toBe(5000);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
