// Derived drill values (data-model.md "Derived values", research R11): a problem's result, the
// current problem of a round and a round's note. Pure, over plain rows; never stored.
import type { Result, RungState, Verdict } from "./progression";

export type VerdictRow = { attemptId: string; attemptAt: Date; verdict: Verdict; hinted: boolean; at: Date; verdictId: string };
export type OverrideRow = { verdictId: string; verdict: Verdict; at: Date };
export type ProblemEventRow = { type: "hint" | "reveal" | "flag" | "skip" | "replaced"; at: Date };

/**
 * A problem's result (FR-017, FR-018). The newest decision wins: an AI verdict, or the user's
 * override of any verdict, whichever was made last.
 * - The user's override counts as given (Article I).
 * - An AI `solved` on an attempt made after a hint counts as `partly_solved`.
 * - A solution revealed before the deciding attempt, or with no decision at all, makes it
 *   `not_solved`. Revealing it after solving doesn't change the result.
 * With no decision and no reveal it is `unattempted`.
 */
export function problemResult(verdicts: VerdictRow[], overrides: OverrideRow[], events: ProblemEventRow[]): Result {
  const reveal = events.filter((e) => e.type === "reveal").map((e) => e.at.getTime());
  const firstReveal = reveal.length ? Math.min(...reveal) : null;
  const newestVerdict = newest(verdicts);
  const known = new Set(verdicts.map((v) => v.verdictId));
  const newestOverride = newest(overrides.filter((o) => known.has(o.verdictId)));

  if (newestOverride && (!newestVerdict || newestOverride.at >= newestVerdict.at)) return newestOverride.verdict;
  if (!newestVerdict) return firstReveal !== null ? "not_solved" : "unattempted";
  if (firstReveal !== null && firstReveal <= newestVerdict.attemptAt.getTime()) return "not_solved";
  if (newestVerdict.verdict === "solved" && newestVerdict.hinted) return "partly_solved";
  return newestVerdict.verdict;
}

function newest<T extends { at: Date }>(rows: T[]): T | undefined {
  let best: T | undefined;
  for (const r of rows) if (!best || r.at >= best.at) best = r;
  return best;
}

/** The current problem (FR-009, R11): lowest position with no result that isn't skipped or flagged. */
export function currentProblem(
  problems: Array<{ id: string; position: number; result: Result; skipped: boolean; flagged: boolean }>,
): string | null {
  const open = problems
    .filter((p) => p.result === "unattempted" && !p.skipped && !p.flagged)
    .sort((a, b) => a.position - b.position);
  return open[0]?.id ?? null;
}

export type ChangeRow = {
  id: string;
  rungId: string;
  fromLevel: number | null;
  toLevel: number;
  fromState: RungState | null;
  toState: RungState;
  cause: "start" | "auto" | "recompute" | "manual";
  evidence: string[];
  supersedes: string | null;
};

/** A round's note (FR-020): its changes, where a recompute is shown in place of what it supersedes. */
export function roundNote(changes: ChangeRow[]): ChangeRow[] {
  const superseded = new Set(changes.map((c) => c.supersedes).filter((id): id is string => id !== null));
  return changes.filter((c) => !superseded.has(c.id));
}
