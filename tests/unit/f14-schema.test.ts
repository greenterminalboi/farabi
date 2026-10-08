import { describe, expect, it } from "vitest";
import { parseScene, type Scene } from "@/viz";

// Feature 014, FR-002, SC-003: every invalid scene is refused with located problems.

const base = (): Scene => ({
  version: 1,
  title: "T",
  description: "D",
  family: "algorithm",
  origin: "user-authored",
  elements: [
    { type: "array", id: "arr", x: 0, y: 0, values: [3, 1, 2] },
    { type: "code", id: "code", x: 0, y: 100, lines: ["a = 1", "b = 2"] },
    { type: "panel", id: "vars", x: 300, y: 0, rows: [{ key: "a", value: 1 }] },
    { type: "stack", id: "st", x: 300, y: 200, frames: [] },
    { type: "box", id: "b1", x: 500, y: 0, label: "One" },
    { type: "box", id: "b2", x: 500, y: 100, label: "Two" },
    { type: "connector", id: "c", from: "b1", to: "b2", relation: "supports" },
    { type: "graph", id: "g", x: 0, y: 250, nodes: [{ id: "A", label: "A" }, { id: "B", label: "B" }], edges: [{ from: "A", to: "B" }] },
  ],
  steps: [],
});

function withSteps(actions: unknown[]): unknown {
  return { ...base(), steps: [{ caption: "s", actions }] };
}

function problemsOf(input: unknown) {
  const r = parseScene(input);
  expect(r.ok, JSON.stringify(r)).toBe(false);
  return r.ok ? [] : r.problems;
}

describe("Feature 014 · scene validation", () => {
  it("accepts a valid scene with every element type", () => {
    expect(parseScene(base()).ok).toBe(true);
  });

  it("accepts every action used correctly", () => {
    const r = parseScene(
      withSteps([
        { op: "highlight", target: "arr", part: 0, tone: "good" },
        { op: "compare", target: "arr", i: 0, j: 1 },
        { op: "swap", target: "arr", i: 0, j: 2 },
        { op: "pointer", target: "arr", name: "i", index: 3 },
        { op: "set", target: "arr", part: 1, value: 9 },
        { op: "set", target: "vars", part: "b", value: "new" },
        { op: "highlight", target: "vars", part: "b" },
        { op: "push", target: "st", label: "main" },
        { op: "highlight", target: "st", part: 0 },
        { op: "line", target: "code", line: 2, tokens: [{ start: 0, end: 1 }] },
        { op: "highlight", target: "code", part: 1 },
        { op: "hide", target: "g", part: "A->B" },
        { op: "show", target: "g", part: "A->B" },
        { op: "highlight", target: "g", part: "B", tone: "bad" },
        { op: "set", target: "g", part: "A", value: "A2" },
        { op: "move", target: "b1", x: 10, y: 10 },
        { op: "set", target: "b2", value: "Two!" },
        { op: "hide", target: "c" },
        { op: "clear", target: "arr" },
        { op: "clear" },
        { op: "pop", target: "st" },
      ]),
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it("refuses an unknown version", () => {
    expect(problemsOf({ ...base(), version: 2 })[0]).toMatchObject({ path: "version", message: expect.stringMatching(/unsupported scene version/) });
  });

  it("refuses missing fields and unknown fields with their paths", () => {
    const { title: _t, ...noTitle } = base();
    void _t;
    expect(problemsOf(noTitle).map((p) => p.path)).toContain("title");
    const extra = { ...base(), elements: [{ type: "box", id: "x", x: 0, y: 0, label: "a", colour: "red" }] };
    expect(problemsOf(extra)[0].path).toMatch(/^elements\.0/);
  });

  it("refuses duplicate ids, bad connector ends and bad graph edges", () => {
    const dup = base();
    dup.elements.push({ type: "box", id: "b1", x: 0, y: 0, label: "again" });
    expect(problemsOf(dup)[0]).toMatchObject({ path: "elements.8.id", message: expect.stringMatching(/duplicate id "b1"/) });
    const conn = base();
    conn.elements.push({ type: "connector", id: "c2", from: "b1", to: "nope" });
    expect(problemsOf(conn)[0]).toMatchObject({ path: "elements.8.to", message: 'no element "nope"' });
    const g = base();
    (g.elements[7] as { edges: unknown[] }).edges.push({ from: "A", to: "Z" });
    expect(problemsOf(g)[0].path).toBe("elements.7.edges.1.to");
  });

  it("refuses targets and parts that don't exist when used", () => {
    const cases: [unknown, string, RegExp][] = [
      [{ op: "highlight", target: "missing" }, "steps.0.actions.0.target", /no element "missing"/],
      [{ op: "highlight", target: "arr", part: 3 }, "steps.0.actions.0.part", /no cell 3/],
      [{ op: "highlight", target: "vars", part: "zz" }, "steps.0.actions.0.part", /no row "zz"/],
      [{ op: "highlight", target: "code", part: 3 }, "steps.0.actions.0.part", /no line 3/],
      [{ op: "highlight", target: "g", part: "C" }, "steps.0.actions.0.part", /no node or edge "C"/],
      [{ op: "highlight", target: "st", part: 0 }, "steps.0.actions.0.part", /no frame 0/],
      [{ op: "pop", target: "st" }, "steps.0.actions.0.target", /empty/],
      [{ op: "swap", target: "code", i: 0, j: 1 }, "steps.0.actions.0.target", /works on array/],
      [{ op: "swap", target: "arr", i: 0, j: 7 }, "steps.0.actions.0.j", /no cell 7/],
      [{ op: "pointer", target: "arr", name: "p", index: 9 }, "steps.0.actions.0.index", /past the end/],
      [{ op: "line", target: "code", line: 1, tokens: [{ start: 2, end: 40 }] }, "steps.0.actions.0.tokens", /outside line 1/],
      [{ op: "move", target: "c", x: 1, y: 1 }, "steps.0.actions.0.target", /connector/],
      [{ op: "highlight", target: "b1", part: 1 }, "steps.0.actions.0.part", /no parts/],
      [{ op: "set", target: "arr", value: 1 }, "steps.0.actions.0.part", /needs a part/],
    ];
    for (const [action, path, message] of cases) {
      const [p] = problemsOf(withSteps([action]));
      expect(p.path, JSON.stringify(action)).toBe(path);
      expect(p.message, JSON.stringify(action)).toMatch(message);
    }
  });

  it("checks references against the state at that step (a popped frame is gone)", () => {
    const scene = {
      ...base(),
      steps: [
        { caption: "push", actions: [{ op: "push", target: "st", label: "f" }] },
        { caption: "ok", actions: [{ op: "highlight", target: "st", part: 0 }] },
        { caption: "pop", actions: [{ op: "pop", target: "st" }] },
        { caption: "bad", actions: [{ op: "highlight", target: "st", part: 0 }] },
      ],
    };
    expect(problemsOf(scene)[0].path).toBe("steps.3.actions.0.part");
  });

  it("enforces limits: 200 elements counting graph nodes, 100 steps, empty captions", () => {
    const many = base();
    many.elements.push({ type: "graph", id: "big", x: 0, y: 0, nodes: Array.from({ length: 60 }, (_, i) => ({ id: `n${i}`, label: "n" })), edges: [] });
    for (let i = 0; i < 135; i++) many.elements.push({ type: "box", id: `x${i}`, x: 0, y: 0, label: "x" });
    expect(problemsOf(many)[0].message).toMatch(/too many elements/);
    const steps = { ...base(), steps: Array.from({ length: 101 }, () => ({ caption: "s", actions: [] })) };
    expect(problemsOf(steps)[0].path).toBe("steps");
    expect(problemsOf(withSteps([]) && { ...base(), steps: [{ caption: "  ", actions: [] }] })[0].path).toBe("steps.0.caption");
  });

  it("never throws on junk input", () => {
    for (const junk of [null, 42, "scene", [], { version: 1 }, { elements: "x" }]) expect(parseScene(junk).ok).toBe(false);
  });
});
