// Rounds (FR-009–FR-013, FR-019–FR-022): generating the next round from the plan, ending a round
// with its automatic level changes, and replacing a flagged problem. The AI is called before
// anything is written, so a failed generation leaves no partial round.
import type { Selectable } from "kysely";
import { AIUnavailableError } from "../ai/provider";
import { db, type Trx } from "../db/client";
import type { NodesTable } from "../db/schema";
import { ConflictError, FunctionUnavailableError, NotFoundError } from "../errors";
import { insertElement, loadLive } from "../graph/elements";
import { assertId } from "../ids";
import { attachedTexts } from "./attachments";
import { createOffer } from "./offers";
import { allAnswered, isFlagged, loadSnapshot, type ProblemSnap, roundOutcomes } from "./load";
import { drillModel } from "./model";
import { callOperation, drillRound, installDrillFakes } from "./operations";
import { EARLIER_CHARS, MAX_MISTAKES, rejectDuplicates, type RoundInput, type RoundOutput } from "./operations/round";
import { activeRungs, levelChanges, type PlanSlot, roundPlan } from "./progression";
import { asLadder, currentLevels, drillSettings, type DrillRow, latestLadder, loadDrillRow, lockDrill, openRound } from "./state";

type Row = Selectable<NodesTable>;

const props = <T>(row: Row) => row.properties as T;

/** Earlier problems, recent mistakes and the problems they came from, for the round prompt (R8, FR-013). */
function history(problems: ProblemSnap[]) {
  const earlier = problems.map((p) => p.row.text!.slice(0, EARLIER_CHARS));
  const mistakes = problems
    .flatMap((p) =>
      p.attempts
        .filter((a) => a.verdict && props<{ verdict: string }>(a.verdict).verdict !== "solved")
        .map((a) => ({ problem: p, attempt: a.row, verdict: a.verdict! })),
    )
    .sort((a, b) => b.attempt.created_at.getTime() - a.attempt.created_at.getTime())
    .slice(0, MAX_MISTAKES);
  return { earlier, mistakes };
}

/** Calls drill_round and drops repeats; with any repeats it asks once more and fills from that (R8). */
async function writeRound(input: RoundInput): Promise<{ out: RoundOutput; kept: Array<RoundOutput["problems"][number] | null> }> {
  installDrillFakes();
  const model = await drillModel();
  const call = () => callOperation(drillRound, input, { model });
  try {
    const out = await call();
    const first = rejectDuplicates(out.problems, input.earlier);
    let kept: Array<RoundOutput["problems"][number] | null> = out.problems.map((p) => (first.kept.includes(p) ? p : null));
    if (first.rejected.length) {
      const again = await call();
      const used = [...input.earlier, ...first.kept.map((p) => p.text)];
      kept = kept.map((p, i) => {
        if (p) return p;
        const candidate = again.problems[i];
        const ok = candidate && rejectDuplicates([candidate], used).kept.length === 1;
        if (ok) used.push(candidate.text);
        return ok ? candidate : null;
      });
    }
    return { out, kept };
  } catch (err) {
    if (err instanceof AIUnavailableError) throw new FunctionUnavailableError(err.message);
    throw err;
  }
}

/** Inserts a problem with its hint and solution under a round edge. */
async function insertProblem(
  trx: Trx,
  round: Pick<Row, "id" | "tree_id" | "project_id">,
  p: RoundOutput["problems"][number],
  slot: PlanSlot,
  extra: { position: number; informedBy: string[]; readAttachments: string[]; replaces?: string },
): Promise<Row> {
  const base = {
    parentId: round.id,
    treeId: round.tree_id,
    projectId: round.project_id,
    origin: "run" as const,
    provenance: "ai_suggested" as const,
    functionId: drillRound.id,
    functionVersion: drillRound.version,
  };
  const problem = await insertElement(trx, {
    ...base,
    kind: "drill_problem",
    text: p.text,
    properties: {
      rungIds: slot.rungIds,
      level: slot.level,
      position: extra.position,
      informedBy: extra.informedBy,
      readAttachments: extra.readAttachments,
      ...(extra.replaces ? { replaces: extra.replaces } : {}),
    },
  });
  await insertElement(trx, { ...base, kind: "drill_hint", text: p.hint, properties: { problemId: problem.id } });
  await insertElement(trx, { ...base, kind: "drill_solution", text: p.solution, properties: { problemId: problem.id } });
  return problem;
}

/**
 * Generates the next round (FR-009, FR-022): lessons for rungs that just opened, then problems
 * filling the plan. 409 `round_open` while a round is open. A round left short by repeats says so.
 */
export async function generateRound(drillId: string): Promise<void> {
  const drill = await loadDrillRow(db, drillId);
  if (drill.started_at === null) throw new ConflictError("not_started", "Start the drill first");
  if (await openRound(db, drill)) throw new ConflictError("round_open", "Finish or end the current round first");
  const [ladder, levels, settings, snapshot, attachments] = await Promise.all([
    latestLadder(db, drill.id),
    currentLevels(db, drill.id),
    drillSettings(drill),
    loadSnapshot(db, drill),
    attachedTexts(drill.id),
  ]);
  const rungs = asLadder(ladder.rungs);
  const slots = roundPlan(rungs, levels, settings);
  if (slots.length === 0) throw new ConflictError("no_open_rung", "No rung is open");
  const taught = new Set(snapshot.rounds.flatMap((r) => r.lessons.map((l) => props<{ rungId: string }>(l).rungId)));
  const lessonRungIds = activeRungs(rungs, levels)
    .map((r) => r.id)
    .filter((id) => !taught.has(id));
  const { earlier, mistakes } = history([...snapshot.problems.values()]);
  const input: RoundInput = {
    domain: drill.domain,
    roundNumber: snapshot.rounds.length + 1,
    ladder: rungs.filter((r) => !r.removed).map((r) => ({ id: r.id, name: r.name })),
    slots,
    lessonRungIds,
    earlier,
    mistakes: mistakes.map((m) => ({
      problem: m.problem.row.text!.slice(0, EARLIER_CHARS),
      attempt: m.attempt.text!.slice(0, 500),
      feedback: m.verdict.text!,
    })),
    attachments,
  };
  const { out, kept } = await writeRound(input);
  const read = attachments.map((a) => a.nodeId);
  const short = kept.filter((p) => p === null).length;

  await db.transaction().execute(async (trx) => {
    const locked = await lockDrill(trx, drill.id);
    if (await openRound(trx, locked)) throw new ConflictError("round_open", "Finish or end the current round first");
    const node = await loadLive(trx, drill.node_id);
    const round = await insertElement(trx, {
      kind: "drill_round",
      parentId: node.id,
      treeId: node.tree_id,
      projectId: node.project_id,
      origin: "run",
      provenance: "ai_suggested",
      functionId: drillRound.id,
      functionVersion: drillRound.version,
      properties: {
        number: input.roundNumber,
        plan: slots,
        ...(short ? { note: `${short} of ${slots.length} problems repeated earlier ones and were left out.` } : {}),
      },
    });
    for (const lesson of out.lessons.filter((l) => lessonRungIds.includes(l.rungId))) {
      await insertElement(trx, {
        kind: "drill_lesson",
        parentId: round.id,
        treeId: round.tree_id,
        projectId: round.project_id,
        origin: "run",
        provenance: "ai_suggested",
        functionId: drillRound.id,
        functionVersion: drillRound.version,
        text: lesson.text,
        properties: { rungId: lesson.rungId, readAttachments: read },
      });
    }
    let position = 0;
    for (const [i, p] of kept.entries()) {
      if (!p) continue;
      const informedBy = mistakes.filter((m) => props<{ rungIds: string[] }>(m.problem.row).rungIds.some((r) => slots[i].rungIds.includes(r)));
      await insertProblem(trx, round, p, slots[i], {
        position: position++,
        informedBy: informedBy.map((m) => m.attempt.id),
        readAttachments: read,
      });
    }
  });
}

/** Generates the next round, returning the failure instead of throwing it (after an end or a start). */
export async function generateRoundAfter(drillId: string): Promise<{ code: string; message: string } | undefined> {
  try {
    await generateRound(drillId);
    return undefined;
  } catch (err) {
    if (err instanceof FunctionUnavailableError || err instanceof ConflictError) return { code: err.code, message: err.message };
    throw err;
  }
}

async function roundAndDrill(trx: Trx, roundId: string): Promise<{ round: Row; drill: DrillRow }> {
  assertId(roundId, "Round");
  const round = await loadLive(trx, roundId);
  if (round.kind !== "drill_round") throw new NotFoundError("Round not found");
  const found = await trx.selectFrom("drills").select("id").where("node_id", "=", round.parent_id!).executeTakeFirstOrThrow();
  return { round, drill: await lockDrill(trx, found.id) };
}

/**
 * Ends a round (FR-019, FR-020, FR-022): records the end, then each rung's automatic change with
 * the attempts behind it. Attempts made during the round on earlier rounds' problems (a redo from
 * the failed list) count for this round too (FR-023 AS2). Returns the drill and whether the drill
 * is now complete; the caller generates the next round.
 */
export async function endRound(roundId: string, by: "all_answered" | "user"): Promise<{ drillId: string; complete: boolean }> {
  return db.transaction().execute(async (trx) => {
    const { round, drill } = await roundAndDrill(trx, roundId);
    const ended = await trx.selectFrom("drill_round_ends").select("round_id").where("round_id", "=", round.id).executeTakeFirst();
    if (ended) throw new ConflictError("round_ended", "This round has already ended");
    const snapshot = await loadSnapshot(trx, drill);
    const mine = snapshot.rounds.find((r) => r.row.id === round.id)!;
    if (by === "all_answered" && !allAnswered(mine)) throw new ConflictError("not_all_answered", "Some problems have no result yet");
    const high = await trx
      .selectFrom("drill_level_changes")
      .select((eb) => eb.fn.max("seq").as("seq"))
      .where("drill_id", "=", drill.id)
      .executeTakeFirst();
    await trx.insertInto("drill_round_ends").values({ round_id: round.id, ended_by: by, levels_seq: String(high?.seq ?? 0) }).execute();

    // Redo attempts from the failed list count for the round they were made in (FR-023 AS2).
    const outcomes = roundOutcomes(snapshot, mine);
    const [ladder, levels, settings] = await Promise.all([latestLadder(trx, drill.id), currentLevels(trx, drill.id), drillSettings(drill, trx)]);
    const { changes, complete } = levelChanges(outcomes, asLadder(ladder.rungs), levels, settings);
    if (changes.length) {
      await trx
        .insertInto("drill_level_changes")
        .values(
          changes.map((c) => ({
            drill_id: drill.id,
            rung_id: c.rungId,
            round_id: round.id,
            from_level: c.fromLevel,
            to_level: c.toLevel,
            from_state: c.fromState,
            to_state: c.toState,
            cause: "auto" as const,
            provenance: "ai_suggested" as const,
            evidence: c.evidence,
          })),
        )
        .execute();
    }
    return { drillId: drill.id, complete };
  });
}

/**
 * Replaces a flagged problem (FR-014): one new problem on the same rungs and level, added beside it
 * in the same open round, linked by `replaces`. The flagged one is kept.
 */
export async function replaceProblem(problemId: string): Promise<string> {
  assertId(problemId, "Problem");
  const problem = await loadLive(db, problemId);
  if (problem.kind !== "drill_problem") throw new NotFoundError("Problem not found");
  const found = await db.selectFrom("nodes").select("parent_id").where("id", "=", problem.parent_id!).executeTakeFirstOrThrow();
  const drill = await db.selectFrom("drills").selectAll().where("node_id", "=", found.parent_id!).executeTakeFirstOrThrow();
  const snapshot = await loadSnapshot(db, drill);
  const snap = snapshot.problems.get(problem.id)!;
  if (!isFlagged(snap)) throw new ConflictError("not_flagged", "Only a flagged problem can be replaced");
  const round = snapshot.rounds.find((r) => r.row.id === snap.roundId)!;
  if (round.end) throw new ConflictError("round_ended", "This round has ended");
  if (snap.events.some((e) => e.type === "replaced")) throw new ConflictError("already_replaced", "This problem was already replaced");

  const ladder = await latestLadder(db, drill.id);
  const pp = props<{ rungIds: string[]; level: number }>(problem);
  const slot: PlanSlot = { rungIds: pp.rungIds, level: pp.level };
  const attachments = await attachedTexts(drill.id);
  const { earlier, mistakes } = history([...snapshot.problems.values()]);
  const input: RoundInput = {
    domain: drill.domain,
    roundNumber: round.number,
    ladder: asLadder(ladder.rungs)
      .filter((r) => !r.removed)
      .map((r) => ({ id: r.id, name: r.name })),
    slots: [slot],
    lessonRungIds: [],
    earlier,
    mistakes: mistakes.map((m) => ({ problem: m.problem.row.text!.slice(0, EARLIER_CHARS), attempt: m.attempt.text!.slice(0, 500), feedback: m.verdict.text! })),
    attachments,
    replacing: problem.text!,
  };
  const { kept } = await writeRound(input);
  const p = kept[0];
  if (!p) throw new FunctionUnavailableError("the replacement repeated an earlier problem");

  return db.transaction().execute(async (trx) => {
    await lockDrill(trx, drill.id);
    const position = Math.max(...round.problems.map((x) => props<{ position: number }>(x.row).position)) + 1;
    const created = await insertProblem(trx, round.row, p, slot, {
      position,
      informedBy: [],
      readAttachments: attachments.map((a) => a.nodeId),
      replaces: problem.id,
    });
    await trx
      .insertInto("drill_problem_events")
      .values({ problem_id: problem.id, type: "replaced", detail: JSON.stringify({ byProblemId: created.id }) })
      .execute();
    return created.id;
  });
}

/**
 * Ends a round and moves on (FR-022, FR-032): the end and its changes, the offer if the drill just
 * became complete, then the next round. A failure to generate keeps everything before it and is
 * returned for the "Generate next round" retry.
 */
export async function finishRound(roundId: string, by: "all_answered" | "user") {
  const { drillId, complete } = await endRound(roundId, by);
  if (complete) await createOffer(drillId, roundId);
  return { drillId, nextRoundError: await generateRoundAfter(drillId) };
}
