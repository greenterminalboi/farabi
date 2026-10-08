import { describe, expect, it } from "vitest";
import { argumentMap, arraySort, codeTrace, contradiction, GALLERY, parseScene, perfScene } from "@/viz";

// Feature 014: templates and gallery examples always produce valid scenes (FR-019, SC-001).

const ok = (s: unknown) => {
  const r = parseScene(s);
  expect(r.ok, JSON.stringify(r.ok ? "" : r.problems)).toBe(true);
};

describe("Feature 014 · templates and gallery", () => {
  it("has at least two examples per family, all valid and user-authored", () => {
    for (const family of ["code", "algorithm", "argument"]) expect(GALLERY.filter((g) => g.family === family).length).toBeGreaterThanOrEqual(2);
    for (const g of GALLERY) {
      ok(g.scene);
      expect(g.scene.origin).toBe("user-authored");
      expect(g.scene.family).toBe(g.family);
    }
  });

  it("the perf scene has exactly 200 elements and is valid", () => {
    const s = perfScene();
    expect(s.elements).toHaveLength(200);
    ok(s);
  });

  it("arraySort sorts and stays within the step limit", () => {
    for (const algorithm of ["bubble", "insertion"] as const) {
      const s = arraySort({ values: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0, -1, -2], algorithm });
      ok(s);
      expect(s.steps.length).toBeLessThanOrEqual(100);
    }
    expect(arraySort({ values: [3, 1, 2] }).steps.at(-1)!.caption).toBe("Sorted: 1, 2, 3");
  });

  it("codeTrace turns stack snapshots into push/pop and tolerates bad input", () => {
    const s = codeTrace({
      title: "t",
      source: "a\nb\n" + "x".repeat(400),
      trace: [
        { line: 1, caption: "one", stack: ["main", "f"] },
        { line: 99, caption: "", stack: ["main", "g"], tokens: [{ start: 0, end: 50 }] },
      ],
    });
    ok(s);
    expect(s.steps[1].caption).toBe("Line 3");
    expect(s.steps[1].actions.filter((a) => a.op === "pop")).toHaveLength(1);
  });

  it("contradiction and argumentMap are valid, with long text clipped", () => {
    ok(contradiction({ a: "x".repeat(500), b: "y", supportsA: ["e1", "e2"], supportsB: ["f1"] }));
    ok(
      argumentMap({
        claims: [
          { id: "c", text: "claim" },
          { id: "p", text: "premise" },
          { id: "q", text: "cycle" },
        ],
        relations: [
          { from: "p", to: "c", relation: "supports" },
          { from: "q", to: "p", relation: "attacks" },
          { from: "p", to: "q", relation: "attacks" },
          { from: "zz", to: "c", relation: "supports" },
        ],
      }),
    );
  });
});
