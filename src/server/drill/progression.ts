// Drill progression (Feature 12, research R7): pure functions from a round's results to level and
// state changes, and from the ladder to the next round's plan. No database or AI access, so every
// rule is unit-tested (tests/unit/f12-progression.test.ts). The AI only fills a plan's slots; it
// never chooses levels (Article VI).

export type RungState = "locked" | "open" | "solid";
export type Verdict = "solved" | "partly_solved" | "not_solved";
export type Result = Verdict | "unattempted";

export type LadderRung = { id: string; name: string; removed: boolean };
export type RungLevel = { level: number; state: RungState };
export type DrillSettings = { roundSize: number; openLevel: number; solidLevel: number };

export const DEFAULT_SETTINGS: DrillSettings = { roundSize: 4, openLevel: 4, solidLevel: 7 };
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 10;
/** From this level a problem may combine two rungs (FR-011). */
export const COMBINE_LEVEL = 5;

/** One problem's part in a round: its rungs, its result and the attempts behind that result. */
export type ProblemOutcome = {
  problemId: string;
  rungIds: string[];
  result: Result;
  /** Flagged problems are kept but left out of progression (FR-014). */
  flagged: boolean;
  attemptIds: string[];
};

export type LevelChange = {
  rungId: string;
  fromLevel: number;
  toLevel: number;
  fromState: RungState;
  toState: RungState;
  /** The attempts that caused it (FR-020). */
  evidence: string[];
};

const clamp = (n: number) => Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, n));

/** Rungs that take part in rounds: not removed, open or solid, in ladder order. */
export function activeRungs(ladder: LadderRung[], levels: ReadonlyMap<string, RungLevel>): LadderRung[] {
  return ladder.filter((r) => !r.removed && levels.get(r.id) !== undefined && levels.get(r.id)!.state !== "locked");
}

/** The newest open rung: the last active rung in ladder order (rungs open in that order, FR-007). */
export function newestOpen(ladder: LadderRung[], levels: ReadonlyMap<string, RungLevel>): LadderRung | null {
  return activeRungs(ladder, levels).at(-1) ?? null;
}

/** A non-locked rung's state follows its level: solid from `solidLevel` (FR-007). */
function stateFor(level: number, settings: DrillSettings): RungState {
  return level >= settings.solidLevel ? "solid" : "open";
}

/** Every rung that isn't removed is solid. A ladder with no rungs is never complete. */
export function isComplete(ladder: LadderRung[], levels: ReadonlyMap<string, RungLevel>): boolean {
  const live = ladder.filter((r) => !r.removed);
  return live.length > 0 && live.every((r) => levels.get(r.id)?.state === "solid");
}

/**
 * The automatic changes when a round ends (FR-019, FR-007, FR-020):
 * - each active rung moves up one if every attempted problem on it was solved, down one (not below
 *   1) if every attempted one was not solved, and holds otherwise; with nothing attempted on it,
 *   nothing changes; flagged problems don't count
 * - a combined problem counts for both of its rungs
 * - a rung at `solidLevel` or above is solid, below it open
 * - when the newest open rung is at `openLevel` or above, the next locked rung in ladder order opens
 *   at level 1 (one per round), citing the newest rung's attempts
 * Returns only real changes, and whether the drill is then complete.
 */
export function levelChanges(
  outcomes: ProblemOutcome[],
  ladder: LadderRung[],
  levels: ReadonlyMap<string, RungLevel>,
  settings: DrillSettings,
): { changes: LevelChange[]; complete: boolean } {
  const after = new Map(levels);
  const changes: LevelChange[] = [];
  const evidenceOf = new Map<string, string[]>();

  for (const rung of activeRungs(ladder, levels)) {
    const mine = outcomes.filter((o) => !o.flagged && o.rungIds.includes(rung.id) && o.result !== "unattempted");
    if (mine.length === 0) continue;
    const evidence = mine.flatMap((o) => o.attemptIds);
    evidenceOf.set(rung.id, evidence);
    const before = levels.get(rung.id)!;
    const step = mine.every((o) => o.result === "solved") ? 1 : mine.every((o) => o.result === "not_solved") ? -1 : 0;
    const toLevel = clamp(before.level + step);
    const toState = stateFor(toLevel, settings);
    if (toLevel === before.level && toState === before.state) continue;
    after.set(rung.id, { level: toLevel, state: toState });
    changes.push({ rungId: rung.id, fromLevel: before.level, toLevel, fromState: before.state, toState, evidence });
  }

  const newest = newestOpen(ladder, after);
  const nextLocked = ladder.find((r) => !r.removed && after.get(r.id)?.state === "locked");
  if (nextLocked && (newest === null || after.get(newest.id)!.level >= settings.openLevel)) {
    const before = after.get(nextLocked.id)!;
    const toLevel = MIN_LEVEL;
    after.set(nextLocked.id, { level: toLevel, state: "open" });
    changes.push({
      rungId: nextLocked.id,
      fromLevel: before.level,
      toLevel,
      fromState: "locked",
      toState: "open",
      evidence: newest ? (evidenceOf.get(newest.id) ?? []) : [],
    });
  }

  return { changes, complete: isComplete(ladder, after) };
}

/** One problem the next round must contain: its rungs (one, or two when combined) and level. */
export type PlanSlot = { rungIds: string[]; level: number };

/**
 * The next round's plan (FR-009–FR-011):
 * - `roundSize` problems; with a single active rung, all of them are on it
 * - otherwise at least ⌈n/2⌉ go to the newest open rung, and the rest review the older active rungs
 *   round-robin, lowest level first (ladder order breaks ties)
 * - at most one problem per round combines the newest rung with a review rung, and only when both
 *   are at level 5 or above; it replaces that rung's first review slot, at the lower of the levels
 * Each slot is at its rung's current level. No active rung gives an empty plan.
 */
export function roundPlan(ladder: LadderRung[], levels: ReadonlyMap<string, RungLevel>, settings: DrillSettings): PlanSlot[] {
  const active = activeRungs(ladder, levels);
  const newest = active.at(-1);
  if (!newest) return [];
  const n = settings.roundSize;
  const levelOf = (id: string) => levels.get(id)!.level;
  const own = (id: string): PlanSlot => ({ rungIds: [id], level: levelOf(id) });
  if (active.length === 1) return Array.from({ length: n }, () => own(newest.id));

  const newestCount = Math.ceil(n / 2);
  const reviewers = active
    .slice(0, -1)
    .map((r, order) => ({ id: r.id, order }))
    .sort((a, b) => levelOf(a.id) - levelOf(b.id) || a.order - b.order);
  const review: PlanSlot[] = Array.from({ length: n - newestCount }, (_, i) => own(reviewers[i % reviewers.length].id));

  if (levelOf(newest.id) >= COMBINE_LEVEL) {
    const i = review.findIndex((s) => levelOf(s.rungIds[0]) >= COMBINE_LEVEL);
    if (i >= 0) {
      const other = review[i].rungIds[0];
      review[i] = { rungIds: [newest.id, other], level: Math.min(levelOf(newest.id), levelOf(other)) };
    }
  }
  return [...Array.from({ length: newestCount }, () => own(newest.id)), ...review];
}

/**
 * A recompute after an override on an ended round (FR-021): the change that round should have made,
 * applied as a difference to the rung's current level, so rounds after it keep their effect.
 */
export function recomputeLevel(
  current: RungLevel,
  recorded: { fromLevel: number; toLevel: number } | null,
  corrected: { fromLevel: number; toLevel: number } | null,
  settings: DrillSettings,
): RungLevel | null {
  const delta = (corrected ? corrected.toLevel - corrected.fromLevel : 0) - (recorded ? recorded.toLevel - recorded.fromLevel : 0);
  if (delta === 0 || current.state === "locked") return null;
  const level = clamp(current.level + delta);
  const state = stateFor(level, settings);
  if (level === current.level && state === current.state) return null;
  return { level, state };
}
