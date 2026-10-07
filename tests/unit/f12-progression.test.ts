import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  type LadderRung,
  levelChanges,
  type ProblemOutcome,
  recomputeLevel,
  type Result,
  roundPlan,
  type RungLevel,
} from "@/server/drill/progression";

// Feature 12, research R7: levels move up one, hold or down one per round; the newest open rung
// opens the next at level 4; solid from 7; plans favour the newest rung (FR-007, FR-009–FR-011,
// FR-019, FR-020).

const ladder: LadderRung[] = ["a", "b", "c"].map((id) => ({ id, name: id.toUpperCase(), removed: false }));
const levels = (entries: Record<string, [number, RungLevel["state"]]>) =>
  new Map(Object.entries(entries).map(([id, [level, state]]) => [id, { level, state }]));
let n = 0;
const outcome = (rungIds: string[], result: Result, flagged = false): ProblemOutcome => ({
  problemId: `p${++n}`,
  rungIds,
  result,
  flagged,
  attemptIds: result === "unattempted" ? [] : [`att${n}`],
});

describe("Feature 12 · levelChanges", () => {
  const start = levels({ a: [1, "open"], b: [1, "locked"], c: [1, "locked"] });

  it("moves up one when every attempted problem is solved, citing the attempts", () => {
    const outs = [outcome(["a"], "solved"), outcome(["a"], "solved")];
    const { changes, complete } = levelChanges(outs, ladder, start, DEFAULT_SETTINGS);
    expect(changes).toEqual([
      { rungId: "a", fromLevel: 1, toLevel: 2, fromState: "open", toState: "open", evidence: outs.flatMap((o) => o.attemptIds) },
    ]);
    expect(complete).toBe(false);
  });

  it("never goes above 10 or below 1", () => {
    const top = levels({ a: [10, "solid"] });
    expect(levelChanges([outcome(["a"], "solved")], [ladder[0]], top, DEFAULT_SETTINGS).changes).toEqual([]);
    expect(levelChanges([outcome(["a"], "not_solved")], ladder, start, DEFAULT_SETTINGS).changes).toEqual([]);
  });

  it("moves down one when none is solved, and holds when mixed or partly solved", () => {
    const at3 = levels({ a: [3, "open"], b: [1, "locked"] });
    expect(levelChanges([outcome(["a"], "not_solved"), outcome(["a"], "not_solved")], ladder, at3, DEFAULT_SETTINGS).changes[0]).toMatchObject({
      fromLevel: 3,
      toLevel: 2,
    });
    expect(levelChanges([outcome(["a"], "solved"), outcome(["a"], "not_solved")], ladder, at3, DEFAULT_SETTINGS).changes).toEqual([]);
    expect(levelChanges([outcome(["a"], "partly_solved")], ladder, at3, DEFAULT_SETTINGS).changes).toEqual([]);
  });

  it("leaves a rung with no attempted problems unchanged, and ignores unattempted and flagged ones", () => {
    expect(levelChanges([outcome(["a"], "unattempted")], ladder, start, DEFAULT_SETTINGS).changes).toEqual([]);
    const outs = [outcome(["a"], "solved"), outcome(["a"], "unattempted"), outcome(["a"], "not_solved", true)];
    expect(levelChanges(outs, ladder, start, DEFAULT_SETTINGS).changes[0]).toMatchObject({ toLevel: 2, evidence: outs[0].attemptIds });
  });

  it("opens the next locked rung in ladder order when the newest open rung reaches the opening level", () => {
    const at3 = levels({ a: [3, "open"], b: [1, "locked"], c: [1, "locked"] });
    const outs = [outcome(["a"], "solved")];
    const { changes } = levelChanges(outs, ladder, at3, DEFAULT_SETTINGS);
    expect(changes).toEqual([
      { rungId: "a", fromLevel: 3, toLevel: 4, fromState: "open", toState: "open", evidence: outs[0].attemptIds },
      { rungId: "b", fromLevel: 1, toLevel: 1, fromState: "locked", toState: "open", evidence: outs[0].attemptIds },
    ]);
    // A removed rung is skipped; reordering locked rungs changes which opens.
    const reordered: LadderRung[] = [ladder[0], { ...ladder[1], removed: true }, ladder[2]];
    expect(levelChanges(outs, reordered, at3, DEFAULT_SETTINGS).changes[1]).toMatchObject({ rungId: "c", toState: "open" });
  });

  it("uses the drill's own thresholds", () => {
    const at1 = levels({ a: [1, "open"], b: [1, "locked"] });
    const settings = { ...DEFAULT_SETTINGS, openLevel: 2, solidLevel: 3 };
    const { changes } = levelChanges([outcome(["a"], "solved")], ladder, at1, settings);
    expect(changes.map((c) => [c.rungId, c.toState])).toEqual([
      ["a", "open"],
      ["b", "open"],
    ]);
  });

  it("marks a rung solid at the solid level and the drill complete when every rung is solid", () => {
    const near = levels({ a: [7, "solid"], b: [6, "open"], c: [9, "solid"] });
    const { changes, complete } = levelChanges([outcome(["b"], "solved")], ladder, near, DEFAULT_SETTINGS);
    expect(changes).toEqual([expect.objectContaining({ rungId: "b", toLevel: 7, fromState: "open", toState: "solid" })]);
    expect(complete).toBe(true);
    // Dropping below the solid level opens the rung again.
    const drop = levelChanges([outcome(["a"], "not_solved")], ladder, near, DEFAULT_SETTINGS);
    expect(drop.changes[0]).toMatchObject({ rungId: "a", toLevel: 6, toState: "open" });
    expect(drop.complete).toBe(false);
  });

  it("counts a combined problem for both of its rungs", () => {
    const two = levels({ a: [5, "open"], b: [5, "open"], c: [1, "locked"] });
    const { changes } = levelChanges([outcome(["a", "b"], "solved")], ladder, two, DEFAULT_SETTINGS);
    expect(changes.map((c) => [c.rungId, c.toLevel])).toEqual([
      ["a", 6],
      ["b", 6],
      ["c", 1],
    ]);
  });
});

describe("Feature 12 · roundPlan", () => {
  const settings = (roundSize: number) => ({ ...DEFAULT_SETTINGS, roundSize });

  it("puts everything on a single open rung, at its level", () => {
    expect(roundPlan(ladder, levels({ a: [2, "open"], b: [1, "locked"] }), settings(4))).toEqual(
      Array(4).fill({ rungIds: ["a"], level: 2 }),
    );
  });

  it("gives at least half to the newest open rung and spreads the rest over older rungs, lowest level first", () => {
    const plan = roundPlan(ladder, levels({ a: [4, "open"], b: [3, "open"], c: [1, "open"] }), settings(5));
    expect(plan.filter((s) => s.rungIds.includes("c"))).toHaveLength(3);
    expect(plan.slice(3)).toEqual([
      { rungIds: ["b"], level: 3 },
      { rungIds: ["a"], level: 4 },
    ]);
    const short = roundPlan(ladder, levels({ a: [2, "open"], b: [3, "open"], c: [1, "open"] }), settings(3));
    expect(short).toEqual([
      { rungIds: ["c"], level: 1 },
      { rungIds: ["c"], level: 1 },
      { rungIds: ["a"], level: 2 },
    ]);
  });

  it("combines at most one review problem with the newest rung, only when both are at level 5 or above", () => {
    const high = roundPlan(ladder, levels({ a: [6, "solid"], b: [5, "open"], c: [5, "open"] }), settings(6));
    const combined = high.filter((s) => s.rungIds.length === 2);
    expect(combined).toEqual([{ rungIds: ["c", "b"], level: 5 }]);
    const low = roundPlan(ladder, levels({ a: [4, "open"], b: [7, "solid"], c: [5, "open"] }), settings(4));
    expect(low.filter((s) => s.rungIds.length === 2)).toEqual([{ rungIds: ["c", "b"], level: 5 }]);
    const none = roundPlan(ladder, levels({ a: [6, "open"], b: [4, "open"] }), settings(4));
    expect(none.every((s) => s.rungIds.length === 1)).toBe(true);
  });

  it("leaves out removed rungs and gives an empty plan with no active rung", () => {
    const removed: LadderRung[] = [{ ...ladder[0], removed: true }, ladder[1]];
    expect(roundPlan(removed, levels({ a: [3, "open"], b: [1, "open"] }), settings(2))).toEqual([
      { rungIds: ["b"], level: 1 },
      { rungIds: ["b"], level: 1 },
    ]);
    expect(roundPlan(ladder, levels({ a: [1, "locked"] }), settings(3))).toEqual([]);
  });
});

describe("Feature 12 · recomputeLevel", () => {
  it("applies the corrected change as a difference to the current level", () => {
    const current = { level: 5, state: "open" as const };
    expect(recomputeLevel(current, { fromLevel: 3, toLevel: 4 }, null, DEFAULT_SETTINGS)).toEqual({ level: 4, state: "open" });
    expect(recomputeLevel(current, null, { fromLevel: 3, toLevel: 4 }, DEFAULT_SETTINGS)).toEqual({ level: 6, state: "open" });
    expect(recomputeLevel(current, { fromLevel: 3, toLevel: 2 }, { fromLevel: 3, toLevel: 4 }, DEFAULT_SETTINGS)).toEqual({
      level: 7,
      state: "solid",
    });
    expect(recomputeLevel(current, { fromLevel: 3, toLevel: 4 }, { fromLevel: 3, toLevel: 4 }, DEFAULT_SETTINGS)).toBeNull();
  });
});
