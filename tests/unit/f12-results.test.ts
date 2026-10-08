import { describe, expect, it } from "vitest";
import { currentProblem, problemResult, roundNote, type ChangeRow, type VerdictRow } from "@/server/drill/results";

// Feature 12, data-model.md "Derived values": results, the current problem and round notes.

const t = (s: number) => new Date(Date.UTC(2026, 9, 7, 12, 0, s));
const verdict = (verdict: VerdictRow["verdict"], at: number, hinted = false): VerdictRow => ({
  attemptId: `a${at}`,
  attemptAt: t(at - 1),
  verdict,
  hinted,
  at: t(at),
  verdictId: `v${at}`,
});

describe("Feature 12 · problemResult", () => {
  it("is unattempted with no decision, else the newest verdict", () => {
    expect(problemResult([], [], [])).toBe("unattempted");
    expect(problemResult([verdict("not_solved", 2), verdict("solved", 4)], [], [])).toBe("solved");
  });

  it("takes the user's override over the verdict it was made after, and a newer verdict over an older override", () => {
    const v = [verdict("not_solved", 2)];
    expect(problemResult(v, [{ verdictId: "v2", verdict: "solved", at: t(3) }], [])).toBe("solved");
    const later = [...v, verdict("partly_solved", 6)];
    expect(problemResult(later, [{ verdictId: "v2", verdict: "solved", at: t(3) }], [])).toBe("partly_solved");
    expect(problemResult(v, [{ verdictId: "elsewhere", verdict: "solved", at: t(3) }], [])).toBe("not_solved");
  });

  it("counts a hinted solve as partly solved", () => {
    expect(problemResult([verdict("solved", 4, true)], [], [{ type: "hint", at: t(1) }])).toBe("partly_solved");
  });

  it("counts a solution revealed before the deciding attempt, or with no attempt, as not solved", () => {
    expect(problemResult([], [], [{ type: "reveal", at: t(1) }])).toBe("not_solved");
    expect(problemResult([verdict("solved", 4)], [], [{ type: "reveal", at: t(1) }])).toBe("not_solved");
    // Looking at the solution after solving doesn't take the solve away.
    expect(problemResult([verdict("solved", 4)], [], [{ type: "reveal", at: t(5) }])).toBe("solved");
    // The user's own verdict stands (Article I).
    expect(problemResult([verdict("solved", 4)], [{ verdictId: "v4", verdict: "solved", at: t(6) }], [{ type: "reveal", at: t(1) }])).toBe(
      "solved",
    );
  });
});

describe("Feature 12 · currentProblem", () => {
  it("is the lowest position with no result that isn't skipped or flagged", () => {
    const p = (id: string, position: number, extra: Partial<{ result: "solved" | "unattempted"; skipped: boolean; flagged: boolean }> = {}) => ({
      id,
      position,
      result: "unattempted" as const,
      skipped: false,
      flagged: false,
      ...extra,
    });
    expect(currentProblem([p("c", 2), p("a", 0, { result: "solved" }), p("b", 1)])).toBe("b");
    expect(currentProblem([p("a", 0, { skipped: true }), p("b", 1, { flagged: true }), p("c", 2)])).toBe("c");
    expect(currentProblem([p("a", 0, { result: "solved" })])).toBeNull();
  });
});

describe("Feature 12 · roundNote", () => {
  it("shows a recompute in place of the change it supersedes", () => {
    const base: Omit<ChangeRow, "id" | "cause" | "supersedes" | "rungId"> = {
      fromLevel: 3,
      toLevel: 4,
      fromState: "open",
      toState: "open",
      evidence: ["att"],
    };
    const changes: ChangeRow[] = [
      { ...base, id: "1", rungId: "a", cause: "auto", supersedes: null },
      { ...base, id: "2", rungId: "b", cause: "auto", supersedes: null },
      { ...base, id: "3", rungId: "a", cause: "recompute", supersedes: "1", toLevel: 3 },
    ];
    expect(roundNote(changes).map((c) => c.id)).toEqual(["2", "3"]);
  });
});
