// Reading a whole drill (T024): its rounds, with their lessons, problems, hints and solutions (shown
// only after their events), attempts, verdicts, overrides and follow-ups, plus the ladder, levels,
// attachments and offer. Derived values come from results.ts and progression.ts; nothing is stored.
import type { Selectable } from "kysely";
import type { Drill, DrillProblem, DrillRound, DrillSummary, Rung } from "@/shared/schemas";
import { db, type DB, type Trx } from "../db/client";
import type {
  DrillLevelChangesTable,
  DrillProblemEventsTable,
  DrillRoundEndsTable,
  DrillVerdictOverridesTable,
  NodesTable,
} from "../db/schema";
import { NotFoundError } from "../errors";
import { toElement } from "../graph/elements";
import { assertId } from "../ids";
import { isComplete, newestOpen, type ProblemOutcome, type Result, type Verdict } from "./progression";
import { currentProblem, problemResult, roundNote } from "./results";
import { asLadder, currentLevels, drillSettings, type DrillRow, latestLadder, loadDrillRow } from "./state";

type Q = DB | Trx;
type Row = Selectable<NodesTable>;
type EventRow = Selectable<DrillProblemEventsTable>;
type OverrideRow = Selectable<DrillVerdictOverridesTable>;
type ChangeRow = Selectable<DrillLevelChangesTable>;

export type AttemptSnap = { row: Row; verdict: Row | null; overrides: OverrideRow[] };
export type ProblemSnap = {
  row: Row;
  roundId: string;
  events: EventRow[];
  attempts: AttemptSnap[];
  hint: Row | null;
  solution: Row | null;
  followUps: Row[];
};
export type RoundSnap = { row: Row; number: number; end: Selectable<DrillRoundEndsTable> | null; lessons: Row[]; problems: ProblemSnap[] };
export type DrillSnapshot = { rounds: RoundSnap[]; problems: Map<string, ProblemSnap> };

const byTime = <T extends { created_at: Date; id?: string }>(a: T, b: T) =>
  a.created_at.getTime() - b.created_at.getTime() || String(a.id ?? "").localeCompare(String(b.id ?? ""));

const props = <T>(row: Row) => row.properties as T;

/** Every drill element under the drill node, in a handful of set-based queries. */
export async function loadSnapshot(q: Q, drill: Pick<DrillRow, "node_id">): Promise<DrillSnapshot> {
  const roundRows = await q.selectFrom("nodes").selectAll().where("parent_id", "=", drill.node_id).where("kind", "=", "drill_round").execute();
  roundRows.sort(byTime);
  const roundIds = roundRows.map((r) => r.id);
  const children = roundIds.length ? await q.selectFrom("nodes").selectAll().where("parent_id", "in", roundIds).execute() : [];
  children.sort(byTime);
  const problems = children.filter((c) => c.kind === "drill_problem");
  const problemIds = problems.map((p) => p.id);
  const [attempts, events, ends] = await Promise.all([
    problemIds.length ? q.selectFrom("nodes").selectAll().where("parent_id", "in", problemIds).execute() : [],
    problemIds.length ? q.selectFrom("drill_problem_events").selectAll().where("problem_id", "in", problemIds).execute() : [],
    roundIds.length ? q.selectFrom("drill_round_ends").selectAll().where("round_id", "in", roundIds).execute() : [],
  ]);
  const attemptRows = attempts.filter((a) => a.kind === "drill_attempt").sort(byTime);
  const attemptIds = attemptRows.map((a) => a.id);
  const verdicts = attemptIds.length
    ? await q.selectFrom("nodes").selectAll().where("parent_id", "in", attemptIds).where("kind", "=", "drill_verdict").execute()
    : [];
  verdicts.sort(byTime);
  const verdictIds = verdicts.map((v) => v.id);
  const [overrides, verdictFollowUps] = await Promise.all([
    verdictIds.length ? q.selectFrom("drill_verdict_overrides").selectAll().where("verdict_id", "in", verdictIds).execute() : [],
    verdictIds.length ? q.selectFrom("nodes").selectAll().where("parent_id", "in", verdictIds).where("kind", "=", "question").execute() : [],
  ]);

  const verdictOf = new Map<string, Row>();
  for (const v of verdicts) if (!verdictOf.has(v.parent_id!)) verdictOf.set(v.parent_id!, v);
  const followUps = [...attempts.filter((a) => a.kind === "question"), ...verdictFollowUps].sort(byTime);
  const verdictParent = new Map(verdicts.map((v) => [v.id, v.parent_id!]));
  const attemptParent = new Map(attemptRows.map((a) => [a.id, a.parent_id!]));
  const problemOfFollowUp = (f: Row) => (verdictParent.has(f.parent_id!) ? attemptParent.get(verdictParent.get(f.parent_id!)!) : f.parent_id);

  const snaps = new Map<string, ProblemSnap>();
  for (const p of problems) {
    const own = (k: string) => children.find((c) => c.kind === k && props<{ problemId: string }>(c).problemId === p.id) ?? null;
    const evs = events.filter((e) => e.problem_id === p.id).sort(byTime);
    snaps.set(p.id, {
      row: p,
      roundId: p.parent_id!,
      events: evs,
      attempts: attemptRows
        .filter((a) => a.parent_id === p.id)
        .map((a) => {
          const verdict = verdictOf.get(a.id) ?? null;
          return { row: a, verdict, overrides: verdict ? overrides.filter((o) => o.verdict_id === verdict.id).sort(byTime) : [] };
        }),
      hint: evs.some((e) => e.type === "hint") ? own("drill_hint") : null,
      solution: evs.some((e) => e.type === "reveal") ? own("drill_solution") : null,
      followUps: followUps.filter((f) => problemOfFollowUp(f) === p.id),
    });
  }

  const rounds = roundRows.map((r) => ({
    row: r,
    number: props<{ number: number }>(r).number,
    end: ends.find((e) => e.round_id === r.id) ?? null,
    lessons: children.filter((c) => c.parent_id === r.id && c.kind === "drill_lesson"),
    problems: problems.filter((p) => p.parent_id === r.id).map((p) => snaps.get(p.id)!),
  }));
  return { rounds, problems: snaps };
}

/**
 * A problem's result (FR-018), optionally counting only what happened from `since` on: a redo
 * during a later round counts for that round (FR-023 AS2).
 */
export function resultOf(p: ProblemSnap, since?: Date, until?: Date): Result {
  const after = (d: Date) => (!since || d >= since) && (!until || d < until);
  const attempts = p.attempts.filter((a) => a.verdict && after(a.row.created_at));
  return problemResult(
    attempts.map((a) => ({
      attemptId: a.row.id,
      attemptAt: a.row.created_at,
      verdict: props<{ verdict: Verdict }>(a.verdict!).verdict,
      hinted: props<{ hinted: boolean }>(a.verdict!).hinted,
      at: a.verdict!.created_at,
      verdictId: a.verdict!.id,
    })),
    attempts.flatMap((a) => a.overrides.map((o) => ({ verdictId: o.verdict_id, verdict: o.verdict, at: o.created_at }))),
    p.events
      .filter((e) => e.type === "hint" || e.type === "reveal")
      .filter((e) => after(e.created_at))
      .map((e) => ({ type: e.type, at: e.created_at })),
  );
}

export const isFlagged = (p: ProblemSnap) => p.events.some((e) => e.type === "flag");
const isSkipped = (p: ProblemSnap) => p.events.some((e) => e.type === "skip");

/** A problem as progression sees it: its rungs, result and the attempts behind it. */
export function outcomeOf(p: ProblemSnap, since?: Date, until?: Date): ProblemOutcome {
  const inWindow = (d: Date) => (!since || d >= since) && (!until || d < until);
  return {
    problemId: p.row.id,
    rungIds: props<{ rungIds: string[] }>(p.row).rungIds,
    result: resultOf(p, since, until),
    flagged: isFlagged(p),
    attemptIds: p.attempts.filter((a) => inWindow(a.row.created_at)).map((a) => a.row.id),
  };
}

/**
 * What a round counts (FR-019, FR-023 AS2): its own problems, plus earlier rounds' problems
 * attempted again while it was open. `until` is the round's end, for a recompute after it.
 */
export function roundOutcomes(snapshot: DrillSnapshot, round: RoundSnap, until?: Date): ProblemOutcome[] {
  const since = round.row.created_at;
  const inWindow = (d: Date) => d >= since && (!until || d < until);
  const redo = [...snapshot.problems.values()].filter(
    (p) => p.roundId !== round.row.id && !isFlagged(p) && p.attempts.some((a) => inWindow(a.row.created_at)),
  );
  return [
    ...round.problems.map((p) => outcomeOf(p, undefined, until)),
    ...redo.map((p) => outcomeOf(p, since, until)).filter((o) => o.result !== "unattempted"),
  ];
}

/** True when every problem of the round has a result or is flagged (FR-022). */
export function allAnswered(round: RoundSnap): boolean {
  return round.problems.length > 0 && round.problems.every((p) => isFlagged(p) || resultOf(p) !== "unattempted");
}

function toProblem(p: ProblemSnap): DrillProblem {
  const pp = props<{ rungIds: string[]; level: number; position: number; replaces?: string }>(p.row);
  return {
    element: toElement(p.row),
    roundId: p.roundId,
    rungIds: pp.rungIds,
    level: pp.level,
    position: pp.position,
    result: resultOf(p),
    flagged: isFlagged(p),
    skipped: isSkipped(p),
    replaces: pp.replaces ?? null,
    hint: p.hint ? toElement(p.hint) : null,
    solution: p.solution ? toElement(p.solution) : null,
    attempts: p.attempts.map((a) => {
      const o = a.overrides.at(-1);
      const v = a.verdict ? props<{ verdict: Verdict; hinted: boolean }>(a.verdict) : null;
      return {
        attempt: toElement(a.row),
        verdict: a.verdict && v ? { ...toElement(a.verdict), verdict: v.verdict, hinted: v.hinted } : null,
        override: o ? { verdict: o.verdict, at: o.created_at.toISOString() } : null,
      };
    }),
    followUps: p.followUps.map((f) => ({ edgeId: f.id, text: f.text, createdAt: f.created_at.toISOString() })),
  };
}

function toRound(r: RoundSnap, changes: ChangeRow[]): DrillRound {
  const problems = r.problems.map(toProblem);
  const mine = changes.filter((c) => c.round_id === r.row.id && (c.cause === "auto" || c.cause === "recompute"));
  const note = roundNote(
    mine.map((c) => ({
      id: c.id,
      rungId: c.rung_id,
      fromLevel: c.from_level,
      toLevel: c.to_level,
      fromState: c.from_state,
      toState: c.to_state,
      cause: c.cause,
      evidence: c.evidence,
      supersedes: c.supersedes,
    })),
  );
  return {
    roundId: r.row.id,
    number: r.number,
    ended: r.end ? { by: r.end.ended_by, at: r.end.created_at.toISOString() } : null,
    shortNote: props<{ note?: string }>(r.row).note ?? null,
    lessons: r.lessons.map((l) => toElement(l)),
    problems,
    note: note.map((c) => ({
      changeId: c.id,
      rungId: c.rungId,
      from: c.fromLevel ?? c.toLevel,
      to: c.toLevel,
      fromState: c.fromState ?? c.toState,
      toState: c.toState,
      evidence: c.evidence,
      cause: c.cause,
    })),
    currentProblemId: r.end
      ? null
      : currentProblem(problems.map((p) => ({ id: p.element.id, position: p.position, result: p.result, skipped: p.skipped, flagged: p.flagged }))),
  };
}

async function summaryOf(q: Q, drill: DrillRow): Promise<DrillSummary> {
  const [ladder, levels, parent] = await Promise.all([
    latestLadder(q, drill.id),
    currentLevels(q, drill.id),
    drill.parent_drill_id ? q.selectFrom("drills").select(["id", "domain"]).where("id", "=", drill.parent_drill_id).executeTakeFirst() : null,
  ]);
  const rungs = asLadder(ladder.rungs);
  const newest = newestOpen(rungs, levels);
  return {
    drillId: drill.id,
    nodeId: drill.node_id,
    domain: drill.domain,
    started: drill.started_at !== null,
    complete: isComplete(rungs, levels),
    newestOpen: newest
      ? { rungId: newest.id, number: rungs.filter((r) => !r.removed).indexOf(newest) + 1, name: newest.name, level: levels.get(newest.id)!.level }
      : null,
    parentDrill: parent ? { drillId: parent.id, domain: parent.domain } : null,
  };
}

/** The canvas cards of a project's drills (FR-024), oldest first. */
export async function loadDrillSummaries(projectId: string, q: Q = db): Promise<DrillSummary[]> {
  const drills = await q.selectFrom("drills").selectAll().where("project_id", "=", projectId).orderBy("created_at").orderBy("id").execute();
  return Promise.all(drills.map((d) => summaryOf(q, d)));
}

/** A whole drill as the drill screen shows it; 404 when the drill or its project is trashed. */
export async function loadDrill(drillId: string, q: Q = db): Promise<Drill> {
  assertId(drillId, "Drill");
  const drill = await loadDrillRow(q, drillId);
  const [summary, ladder, levels, changes, snapshot, settings, node, attachments, offer] = await Promise.all([
    summaryOf(q, drill),
    latestLadder(q, drill.id),
    currentLevels(q, drill.id),
    q.selectFrom("drill_level_changes").selectAll().where("drill_id", "=", drill.id).orderBy("created_at").orderBy("id").execute(),
    loadSnapshot(q, drill),
    drillSettings(drill),
    q.selectFrom("nodes").select("parent_id").where("id", "=", drill.node_id).executeTakeFirstOrThrow(),
    loadAttachments(q, drill.id),
    q.selectFrom("drill_offers").selectAll().where("drill_id", "=", drill.id).executeTakeFirst(),
  ]);
  const roundNumber = new Map(snapshot.rounds.map((r) => [r.row.id, r.number]));
  const rungs: Rung[] = ladder.rungs.map((r) => {
    const history = changes.filter((c) => c.rung_id === r.id);
    const now = levels.get(r.id);
    return {
      id: r.id,
      name: r.name,
      provenance: r.provenance,
      removed: r.removed,
      state: now?.state ?? "locked",
      level: now?.level ?? 1,
      history: history.map((c) => ({
        roundNumber: c.round_id ? (roundNumber.get(c.round_id) ?? null) : null,
        level: c.to_level,
        state: c.to_state,
        cause: c.cause,
        changeId: c.id,
      })),
    };
  });

  let offerOut: Drill["offer"] = null;
  if (offer) {
    const events = await q.selectFrom("drill_offer_events").selectAll().where("offer_id", "=", offer.id).execute();
    const nodes = offer.candidates.length
      ? await q.selectFrom("nodes").select(["id", "text"]).where("id", "in", offer.candidates.map((c) => c.nodeId)).execute()
      : [];
    offerOut = {
      offerId: offer.id,
      candidates: offer.candidates.map((c) => ({ ...c, excerpt: excerpt(nodes.find((n) => n.id === c.nodeId)?.text ?? "") })),
      dismissed: events.some((e) => e.type === "dismissed"),
      picked: events.filter((e) => e.type === "picked").map((e) => e.node_id!),
    };
  }

  return {
    ...summary,
    projectId: drill.project_id,
    domainProvenance: drill.domain_provenance,
    startEdgeId: node.parent_id!,
    sourceNodeId: drill.source_node_id,
    ladder: { versionId: ladder.id, provenance: ladder.provenance, rungs },
    settings: settings.raw as Drill["settings"],
    rounds: snapshot.rounds.map((r) => toRound(r, changes)),
    attachments,
    offer: offerOut,
  };
}

export const excerpt = (text: string, n = 160) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** The attached nodes: those whose newest attachment row is `attach`, in a live state (FR-031). */
export async function loadAttachments(q: Q, drillId: string): Promise<Drill["attachments"]> {
  const rows = await q
    .selectFrom("drill_attachments")
    .innerJoin("nodes", "nodes.id", "drill_attachments.node_id")
    .select(["drill_attachments.node_id", "drill_attachments.action", "drill_attachments.created_at", "nodes.text"])
    .where("drill_attachments.drill_id", "=", drillId)
    .distinctOn("drill_attachments.node_id")
    .orderBy("drill_attachments.node_id")
    .orderBy("drill_attachments.created_at", "desc")
    .orderBy("drill_attachments.id", "desc")
    .execute();
  return rows
    .filter((r) => r.action === "attach")
    .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
    .map((r) => ({ nodeId: r.node_id, excerpt: excerpt(r.text ?? ""), attachedAt: r.created_at.toISOString() }));
}

export function assertFound<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new NotFoundError(`${what} not found`);
  return value;
}
