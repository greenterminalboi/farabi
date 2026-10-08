// Hand-written gallery scenes (FR-019): at least two per family, plus a 200-element scene for the
// performance check (SC-002). All are user-authored and validated by tests/unit/f14-templates.test.ts.
import type { Action, Element, Scene, Step } from "../schema";
import { argumentMap, arraySort, codeTrace, contradiction } from "../templates";

const factorial = codeTrace({
  title: "Recursive factorial",
  description: "factorial(3) calls itself until n is 1, then the results multiply back up the call stack.",
  language: "python",
  source: ["def factorial(n):", "    if n <= 1:", "        return 1", "    return n * factorial(n - 1)", "", "print(factorial(3))"].join("\n"),
  trace: [
    { line: 6, caption: "Call factorial(3)", stack: ["main", "factorial(3)"], vars: { n: 3 } },
    { line: 2, caption: "n is 3, not ≤ 1", stack: ["main", "factorial(3)"], tokens: [{ start: 7, end: 13 }] },
    { line: 4, caption: "Needs factorial(2) first", stack: ["main", "factorial(3)", "factorial(2)"], vars: { n: 2 }, tokens: [{ start: 15, end: 31 }] },
    { line: 2, caption: "n is 2, not ≤ 1", stack: ["main", "factorial(3)", "factorial(2)"] },
    { line: 4, caption: "Needs factorial(1) first", stack: ["main", "factorial(3)", "factorial(2)", "factorial(1)"], vars: { n: 1 } },
    { line: 3, caption: "Base case: factorial(1) returns 1", stack: ["main", "factorial(3)", "factorial(2)", "factorial(1)"], vars: { result: 1 } },
    { line: 4, caption: "factorial(2) returns 2 × 1 = 2", stack: ["main", "factorial(3)", "factorial(2)"], vars: { n: 2, result: 2 } },
    { line: 4, caption: "factorial(3) returns 3 × 2 = 6", stack: ["main", "factorial(3)"], vars: { n: 3, result: 6 } },
    { line: 6, caption: "print shows 6", stack: ["main"] },
  ],
});

const loopSum = codeTrace({
  title: "Summing a list",
  description: "A for loop adds each number to a running total.",
  language: "javascript",
  source: ["const xs = [4, 7, 1];", "let total = 0;", "for (const x of xs) {", "  total += x;", "}", "console.log(total);"].join("\n"),
  trace: [
    { line: 1, caption: "xs holds three numbers", vars: { xs: "[4, 7, 1]" } },
    { line: 2, caption: "total starts at 0", vars: { total: 0 } },
    { line: 3, caption: "First pass: x is 4", vars: { x: 4 } },
    { line: 4, caption: "total becomes 0 + 4 = 4", vars: { total: 4 }, tokens: [{ start: 2, end: 12 }] },
    { line: 3, caption: "Second pass: x is 7", vars: { x: 7 } },
    { line: 4, caption: "total becomes 4 + 7 = 11", vars: { total: 11 } },
    { line: 3, caption: "Third pass: x is 1", vars: { x: 1 } },
    { line: 4, caption: "total becomes 11 + 1 = 12", vars: { total: 12 } },
    { line: 6, caption: "Logs 12" },
  ],
});

const bubble = arraySort({ values: [5, 2, 4, 1, 3], algorithm: "bubble" });

const binarySearch: Scene = {
  version: 1,
  title: "Binary search for 23",
  description: "Searching a sorted array for 23 by halving the range each time.",
  family: "algorithm",
  origin: "user-authored",
  height: 300,
  elements: [
    { type: "text", id: "goal", x: 40, y: 20, text: "Find 23", size: "lg" },
    { type: "array", id: "arr", x: 40, y: 70, label: "sorted values", values: [2, 5, 8, 12, 16, 23, 38, 56, 72, 91], cellWidth: 56, pointers: [{ name: "lo", index: 0 }, { name: "hi", index: 9 }] },
  ],
  steps: [
    { caption: "Middle of 0..9 is 4: 16 < 23, so search the right half", actions: [{ op: "pointer", target: "arr", name: "mid", index: 4 }, { op: "compare", target: "arr", i: 4, j: 4 }] },
    {
      caption: "Move lo past mid",
      actions: [
        { op: "pointer", target: "arr", name: "lo", index: 5 },
        ...[0, 1, 2, 3, 4].map((i) => ({ op: "highlight", target: "arr", part: i, tone: "muted" }) as Action),
      ],
    },
    { caption: "Middle of 5..9 is 7: 56 > 23, so search the left half", actions: [{ op: "pointer", target: "arr", name: "mid", index: 7 }, { op: "compare", target: "arr", i: 7, j: 7 }] },
    {
      caption: "Move hi before mid",
      actions: [{ op: "pointer", target: "arr", name: "hi", index: 6 }, ...[7, 8, 9].map((i) => ({ op: "highlight", target: "arr", part: i, tone: "muted" }) as Action)],
    },
    { caption: "Middle of 5..6 is 5: found 23", actions: [{ op: "pointer", target: "arr", name: "mid", index: 5 }, { op: "highlight", target: "arr", part: 5, tone: "good" }] },
  ],
};

const bfsNodes = ["A", "B", "C", "D", "E", "F"];
const bfs: Scene = {
  version: 1,
  title: "Breadth-first search from A",
  description: "Visiting a graph level by level from A, using a queue.",
  family: "algorithm",
  origin: "user-authored",
  elements: [
    {
      type: "graph",
      id: "g",
      x: 20,
      y: 20,
      w: 460,
      h: 300,
      layout: "tree",
      root: "A",
      nodes: bfsNodes.map((id) => ({ id, label: id })),
      edges: [
        { from: "A", to: "B" },
        { from: "A", to: "C" },
        { from: "B", to: "D" },
        { from: "B", to: "E" },
        { from: "C", to: "F" },
      ],
    },
    { type: "panel", id: "q", x: 520, y: 30, label: "State", rows: [{ key: "queue", value: "A" }, { key: "visited", value: "" }], w: 240 },
  ],
  steps: [
    { caption: "Start at A", actions: [{ op: "highlight", target: "g", part: "A", tone: "accent" }] },
    { caption: "Visit A; queue its neighbours B and C", actions: [{ op: "highlight", target: "g", part: "A", tone: "good" }, { op: "set", target: "q", part: "queue", value: "B, C" }, { op: "set", target: "q", part: "visited", value: "A" }, { op: "highlight", target: "g", part: "A->B" }, { op: "highlight", target: "g", part: "A->C" }] },
    { caption: "Visit B; queue D and E", actions: [{ op: "highlight", target: "g", part: "B", tone: "good" }, { op: "set", target: "q", part: "queue", value: "C, D, E" }, { op: "set", target: "q", part: "visited", value: "A, B" }, { op: "highlight", target: "g", part: "B->D" }, { op: "highlight", target: "g", part: "B->E" }] },
    { caption: "Visit C; queue F", actions: [{ op: "highlight", target: "g", part: "C", tone: "good" }, { op: "set", target: "q", part: "queue", value: "D, E, F" }, { op: "set", target: "q", part: "visited", value: "A, B, C" }, { op: "highlight", target: "g", part: "C->F" }] },
    { caption: "Visit D, E and F: no new neighbours", actions: ["D", "E", "F"].map((id) => ({ op: "highlight", target: "g", part: id, tone: "good" }) as Action).concat([{ op: "set", target: "q", part: "queue", value: "(empty)" }, { op: "set", target: "q", part: "visited", value: "A, B, C, D, E, F" }]) },
  ],
};

const bst: Scene = {
  version: 1,
  title: "Inserting 6 into a binary search tree",
  description: "Walking down from the root, going left for smaller and right for larger, until an empty spot.",
  family: "algorithm",
  origin: "user-authored",
  elements: [
    {
      type: "graph",
      id: "t",
      x: 60,
      y: 20,
      w: 520,
      h: 300,
      layout: "tree",
      root: "n8",
      nodes: [
        { id: "n8", label: "8" },
        { id: "n3", label: "3" },
        { id: "n10", label: "10" },
        { id: "n1", label: "1" },
        { id: "n6", label: "6", hidden: true },
        { id: "n14", label: "14" },
      ],
      edges: [
        { from: "n8", to: "n3" },
        { from: "n8", to: "n10" },
        { from: "n3", to: "n1" },
        { from: "n3", to: "n6", hidden: true },
        { from: "n10", to: "n14" },
      ],
    },
    { type: "text", id: "note", x: 600, y: 60, text: "Insert 6", size: "lg" },
  ],
  steps: [
    { caption: "6 < 8: go left", actions: [{ op: "highlight", target: "t", part: "n8", tone: "partial" }, { op: "highlight", target: "t", part: "n8->n3" }] },
    { caption: "6 > 3: go right", actions: [{ op: "highlight", target: "t", part: "n3", tone: "partial" }] },
    { caption: "3 has no right child: insert 6 there", actions: [{ op: "show", target: "t", part: "n6" }, { op: "show", target: "t", part: "n3->n6" }, { op: "highlight", target: "t", part: "n6", tone: "good" }, { op: "set", target: "note", value: "Inserted 6" }] },
  ],
};

const tension = contradiction({
  title: "Caching: always or never?",
  a: "Cache every API response so the app feels instant.",
  b: "Never show data older than a minute; users act on it.",
  tension: "freshness vs speed",
  supportsA: ["Most reads repeat within seconds."],
  supportsB: ["Prices change every few seconds."],
});

const map = argumentMap({
  title: "Should the team adopt code review?",
  claims: [
    { id: "c", text: "The team should require code review on every change." },
    { id: "p1", text: "Review catches defects before they ship." },
    { id: "p2", text: "Review spreads knowledge of the codebase." },
    { id: "o1", text: "Review slows down urgent fixes." },
    { id: "r1", text: "Urgent fixes can be reviewed after merging." },
  ],
  relations: [
    { from: "p1", to: "c", relation: "supports" },
    { from: "p2", to: "c", relation: "supports" },
    { from: "o1", to: "c", relation: "attacks" },
    { from: "r1", to: "o1", relation: "attacks" },
  ],
});

export type GalleryEntry = { id: string; family: Scene["family"]; scene: Scene };

export const GALLERY: GalleryEntry[] = [
  { id: "factorial", family: "code", scene: factorial },
  { id: "loop-sum", family: "code", scene: loopSum },
  { id: "bubble-sort", family: "algorithm", scene: bubble },
  { id: "binary-search", family: "algorithm", scene: binarySearch },
  { id: "bfs", family: "algorithm", scene: bfs },
  { id: "bst-insert", family: "algorithm", scene: bst },
  { id: "contradiction", family: "argument", scene: tension },
  { id: "argument-map", family: "argument", scene: map },
];

/** 160 boxes and 40 connectors (200 elements); every step moves 50 boxes and highlights others. */
export function perfScene(): Scene {
  const cols = 16;
  const elements: Element[] = [];
  const pos = (i: number) => ({ x: 20 + (i % cols) * 60, y: 20 + Math.floor(i / cols) * 46 });
  for (let i = 0; i < 160; i++) elements.push({ type: "box", id: `b${i}`, ...pos(i), w: 52, h: 34, label: String(i), shape: "rect" });
  for (let i = 0; i < 40; i++) elements.push({ type: "connector", id: `c${i}`, from: `b${i * 4}`, to: `b${i * 4 + 1}`, directed: true });
  const steps: Step[] = [];
  for (let s = 0; s < 24; s++) {
    const actions: Action[] = [{ op: "clear" }];
    for (let k = 0; k < 45; k++) {
      const i = (s * 37 + k * 3) % 160;
      const j = (i + 1 + s * 7) % 160;
      actions.push({ op: "move", target: `b${i}`, ...pos(j) });
    }
    for (let k = 0; k < 4; k++) actions.push({ op: "highlight", target: `b${(s * 11 + k * 40) % 160}`, tone: k % 2 ? "good" : "partial" });
    steps.push({ caption: `Shuffle ${s + 1}`, durationMs: 600, actions });
  }
  return {
    version: 1,
    title: "200 elements",
    description: "A stress scene: 160 boxes and 40 connectors, 45 boxes moving on every step.",
    family: "general",
    origin: "user-authored",
    width: 1000,
    height: 500,
    elements,
    steps,
  };
}
