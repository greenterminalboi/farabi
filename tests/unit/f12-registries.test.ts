import { describe, expect, it } from "vitest";
import { DISPLAY_SHAPE } from "@/shared/kinds/types";
import { getKind, kindsWithSettings } from "@/shared/kinds";
import { validateProperties } from "@/server/graph/elements";

// Feature 12, data-model.md "Element kinds" and contracts/declarations.md.

const drawn = ["drill_start", "drill"];
const hidden = ["drill_round", "drill_lesson", "drill_problem", "drill_hint", "drill_solution", "drill_attempt", "drill_verdict"];

describe("Feature 12 · drill kinds", () => {
  it("registers every drill kind with a display that draws its shape", () => {
    for (const id of [...drawn, ...hidden]) {
      const kind = getKind(id);
      expect(DISPLAY_SHAPE[kind.display]).toBe(kind.shape);
    }
    expect(drawn.map((id) => getKind(id).onCanvas)).toEqual([undefined, undefined]);
    expect(hidden.every((id) => getKind(id).onCanvas === false)).toBe(true);
    expect(getKind("drill")).toMatchObject({ shape: "node", display: "drill" });
  });

  it("gives the turns of a follow-up's context their roles", () => {
    expect(getKind("question").contextRole).toBe("user");
    expect(getKind("answer").contextRole).toBe("ai");
    const roles = Object.fromEntries([...drawn, ...hidden].map((id) => [id, getKind(id).contextRole ?? null]));
    expect(roles).toEqual({
      drill_start: "user",
      drill: null,
      drill_round: null,
      drill_lesson: "ai",
      drill_problem: "ai",
      drill_hint: null,
      drill_solution: null,
      drill_attempt: "user",
      drill_verdict: "ai",
    });
  });

  it("declares the drill settings with their ranges, defaults and the open-before-solid rule", () => {
    const drill = getKind("drill");
    expect(kindsWithSettings().map((k) => k.id)).toContain("drill");
    const summary = drill.settings.map((s) => [s.key, s.choices[0].value, s.choices.at(-1)!.value, s.default]);
    expect(summary).toEqual([
      ["round_size", "1", "10", "4"],
      ["open_level", "2", "9", "4"],
      ["solid_level", "3", "10", "7"],
    ]);
    expect(drill.validateSettings!({ round_size: "4", open_level: "4", solid_level: "7" })).toBeNull();
    expect(drill.validateSettings!({ round_size: "4", open_level: "7", solid_level: "7" })).toMatch(/below/);
  });

  it("rejects undeclared or invalid properties (FR-054)", () => {
    const problem = { rungIds: ["r"], level: 3, position: 0, informedBy: [], readAttachments: [] };
    expect(validateProperties("drill_problem", problem)).toEqual(problem);
    expect(() => validateProperties("drill_problem", { ...problem, extra: 1 })).toThrow();
    expect(() => validateProperties("drill_problem", { ...problem, level: 11 })).toThrow();
    expect(() => validateProperties("drill_problem", { ...problem, rungIds: ["a", "b", "c"] })).toThrow();
    expect(() => validateProperties("drill_verdict", { verdict: "maybe", hinted: false })).toThrow();
    expect(() => validateProperties("drill_attempt", { text: "x" })).toThrow();
  });
});
