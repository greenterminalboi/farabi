import { describe, expect, it } from "vitest";
import { computeStates, describeFrame, GALLERY, sceneOrThrow, type Scene, textAlternative, tick } from "@/viz";

// Feature 014: frame states (data-model.md) and the playback clock (research R4).

const scene: Scene = sceneOrThrow({
  version: 1,
  title: "S",
  description: "D",
  family: "algorithm",
  origin: "user-authored",
  elements: [
    { type: "array", id: "arr", x: 0, y: 0, values: [3, 1, 2], label: "xs" },
    { type: "panel", id: "vars", x: 300, y: 0, rows: [] },
    { type: "stack", id: "st", x: 300, y: 200, frames: ["main"] },
    { type: "code", id: "code", x: 0, y: 100, lines: ["x = 1", "y = 2"] },
  ],
  steps: [
    { caption: "Compare", actions: [{ op: "compare", target: "arr", i: 0, j: 1 }, { op: "pointer", target: "arr", name: "i", index: 0 }] },
    { caption: "Swap", actions: [{ op: "swap", target: "arr", i: 0, j: 1 }, { op: "set", target: "vars", part: "x", value: 1 }] },
    { caption: "Call", actions: [{ op: "push", target: "st", label: "f()" }, { op: "line", target: "code", line: 2 }, { op: "pointer", target: "arr", name: "i", index: null }] },
    { caption: "Return", actions: [{ op: "pop", target: "st" }] },
  ],
});

describe("Feature 014 · frame states", () => {
  const states = computeStates(scene);

  it("has one state per step plus the start", () => {
    expect(states).toHaveLength(5);
  });

  it("swaps keep cell identity, so the renderer animates cells crossing", () => {
    const before = states[1].elements.arr;
    const after = states[2].elements.arr;
    if (before.type !== "array" || after.type !== "array") throw new Error("array");
    expect(before.cells.map((c) => c.key)).toEqual(["c0", "c1", "c2"]);
    expect(after.cells.map((c) => c.key)).toEqual(["c1", "c0", "c2"]);
    expect(after.cells.map((c) => c.value)).toEqual([1, 3, 2]);
  });

  it("compare and swap marks last only for their own step", () => {
    const a = (i: number) => {
      const el = states[i].elements.arr;
      if (el.type !== "array") throw new Error("array");
      return el.cells.map((c) => c.mark);
    };
    expect(a(1)).toEqual(["compare", "compare", null]);
    expect(a(2)).toEqual(["swap", "swap", null]);
    expect(a(3)).toEqual([null, null, null]);
  });

  it("set adds a panel row and marks it changed for that step", () => {
    const v = (i: number) => {
      const el = states[i].elements.vars;
      if (el.type !== "panel") throw new Error("panel");
      return el.rows;
    };
    expect(v(1)).toEqual([]);
    expect(v(2)).toMatchObject([{ key: "x", value: 1, changed: true }]);
    expect(v(3)).toMatchObject([{ key: "x", changed: false }]);
  });

  it("push, pop, line and pointer hide work", () => {
    const st = states[3].elements.st;
    const code = states[3].elements.code;
    const arr = states[3].elements.arr;
    if (st.type !== "stack" || code.type !== "code" || arr.type !== "array") throw new Error("types");
    expect(st.frames.map((f) => f.label)).toEqual(["main", "f()"]);
    expect(code.line).toBe(2);
    expect(arr.pointers).toEqual([{ name: "i", index: null }]);
    const st4 = states[4].elements.st;
    if (st4.type !== "stack") throw new Error("stack");
    expect(st4.frames.map((f) => f.label)).toEqual(["main"]);
  });

  it("describes each frame in plain text (FR-009)", () => {
    expect(describeFrame(scene, 0)).toMatch(/^Start\.\nxs: \[3, 1, 2\]/);
    expect(describeFrame(scene, 1)).toMatch(/comparing positions 0 and 1; pointers i=0/);
    expect(describeFrame(scene, 3)).toMatch(/Stack \(top last\): main, f\(\)\nCode, at line 2: y = 2/);
    expect(textAlternative(scene)).toBe("S.\nD\nStep 1: Compare\nStep 2: Swap\nStep 3: Call\nStep 4: Return");
  });

  it("every gallery frame has a caption and a non-empty summary (SC-005)", () => {
    for (const { scene: s } of GALLERY) {
      for (let i = 0; i <= s.steps.length; i++) {
        const text = describeFrame(s, i);
        expect(text.split("\n").length, `${s.title} frame ${i}`).toBeGreaterThan(1);
      }
    }
  });
});

describe("Feature 014 · playback clock", () => {
  const opts = { reducedMotion: false, speed: 1 };

  it("moves for 55% of a step, then dwells, then moves on", () => {
    let head = { t: 0, hold: 0 };
    head = tick(scene, head, 900 * 0.55 * 0.5, opts);
    expect(head.t).toBeCloseTo(0.5);
    head = tick(scene, head, 900 * 0.55 * 0.5, opts);
    expect(head.t).toBe(1);
    expect(head.hold).toBeCloseTo(900 * 0.45);
    head = tick(scene, head, 900 * 0.45, opts);
    expect(head.t).toBe(1);
    head = tick(scene, head, 10, opts);
    expect(head.t).toBeGreaterThan(1);
  });

  it("with reduced motion jumps a whole step, then dwells for the full duration", () => {
    let head = tick(scene, { t: 0, hold: 0 }, 1, { ...opts, reducedMotion: true });
    expect(head.t).toBe(1);
    head = tick(scene, head, 800, { ...opts, reducedMotion: true });
    expect(head.t).toBe(1);
    head = tick(scene, head, 200, { ...opts, reducedMotion: true });
    expect(head.t).toBe(2);
  });

  it("stops at the end and reports done; speed scales time", () => {
    const end = tick(scene, { t: 3.9, hold: 0 }, 10_000, opts);
    expect(end).toEqual({ t: 4, hold: 0, done: true });
    const fast = tick(scene, { t: 0, hold: 0 }, 900 * 0.55 * 0.25, { ...opts, speed: 2 });
    expect(fast.t).toBeCloseTo(0.5);
  });
});
