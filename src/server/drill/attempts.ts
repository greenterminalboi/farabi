// Attempts and verdicts (FR-015, FR-016): the attempt is stored first, as the user's own words,
// then judged. If judging fails the attempt stays without a verdict and can be judged again.
import { AIUnavailableError } from "../ai/provider";
import { db } from "../db/client";
import { ConflictError, InvalidRequestError } from "../errors";
import { insertElement } from "../graph/elements";
import { drillElement } from "./elements";
import { allAnswered, isFlagged, loadSnapshot } from "./load";
import { drillModel } from "./model";
import { callOperation, drillVerdict, installDrillFakes } from "./operations";
import { latestLadder, lockDrill } from "./state";

export const MAX_ATTEMPT = 20_000;

/** Judging failed; the attempt was kept (503 `verdict_unavailable` with its id). */
export class VerdictUnavailableError extends Error {
  readonly code = "verdict_unavailable";
  constructor(readonly attemptId: string, detail: string) {
    super(`Your attempt was saved, but it couldn't be judged right now. Try again. (${detail})`);
  }
}

/** Judges an attempt and stores the verdict, already complete, in one insert (data-model.md). */
async function judge(attemptId: string): Promise<void> {
  const { row: attempt, drill } = await drillElement(db, attemptId, "drill_attempt", "Attempt");
  const problem = await db.selectFrom("nodes").selectAll().where("id", "=", attempt.parent_id!).executeTakeFirstOrThrow();
  const solution = await db
    .selectFrom("nodes")
    .select("text")
    .where("parent_id", "=", problem.parent_id!)
    .where("kind", "=", "drill_solution")
    .where(({ eb, ref }) => eb(ref("properties", "->>").key("problemId"), "=", problem.id))
    .executeTakeFirst();
  const hints = await db
    .selectFrom("drill_problem_events")
    .select("id")
    .where("problem_id", "=", problem.id)
    .where("type", "=", "hint")
    .where("created_at", "<=", attempt.created_at)
    .execute();
  const ladder = await latestLadder(db, drill.id);
  const rungIds = (problem.properties as { rungIds: string[] }).rungIds;
  const hinted = hints.length > 0;
  installDrillFakes();
  let out;
  try {
    out = await callOperation(
      drillVerdict,
      {
        domain: drill.domain,
        rungNames: ladder.rungs.filter((r) => rungIds.includes(r.id)).map((r) => r.name),
        problem: problem.text!,
        solution: solution?.text ?? "",
        attempt: attempt.text!,
        hinted,
      },
      { model: await drillModel() },
    );
  } catch (err) {
    if (err instanceof AIUnavailableError) throw new VerdictUnavailableError(attempt.id, err.message);
    throw err;
  }
  await db.transaction().execute(async (trx) => {
    await lockDrill(trx, drill.id);
    const existing = await trx.selectFrom("nodes").select("id").where("parent_id", "=", attempt.id).where("kind", "=", "drill_verdict").executeTakeFirst();
    if (existing) throw new ConflictError("already_judged", "This attempt already has a verdict");
    await insertElement(trx, {
      kind: "drill_verdict",
      parentId: attempt.id,
      treeId: attempt.tree_id,
      projectId: attempt.project_id,
      origin: "run",
      provenance: "ai_suggested",
      text: out.feedback,
      functionId: drillVerdict.id,
      functionVersion: drillVerdict.version,
      properties: { verdict: out.verdict, hinted },
    });
  });
}

/** Whether every problem of the drill's open round now has a result, so the client ends it. */
async function openRoundAnswered(drillNodeId: string): Promise<boolean> {
  const snapshot = await loadSnapshot(db, { node_id: drillNodeId });
  const last = snapshot.rounds.at(-1);
  return !!last && !last.end && allAnswered(last);
}

/**
 * Submits an attempt (FR-015) on a problem of the open round or an earlier one (a redo), then
 * judges it. Returns the drill id and whether the open round is now fully answered.
 */
export async function submitAttempt(problemId: string, text: string): Promise<{ drillId: string; roundEnded: boolean }> {
  if (text.trim().length < 1 || text.length > MAX_ATTEMPT) throw new InvalidRequestError(`An attempt is 1 to ${MAX_ATTEMPT} characters`);
  const { row: problem, drill } = await drillElement(db, problemId, "drill_problem", "Problem");
  const attempt = await db.transaction().execute(async (trx) => {
    await lockDrill(trx, drill.id);
    const snapshot = await loadSnapshot(trx, drill);
    if (isFlagged(snapshot.problems.get(problem.id)!)) throw new ConflictError("problem_flagged", "This problem was flagged; it no longer takes attempts");
    return insertElement(trx, {
      kind: "drill_attempt",
      parentId: problem.id,
      treeId: problem.tree_id,
      projectId: problem.project_id,
      origin: "ask",
      provenance: "user_authored",
      text,
      sentAt: new Date(),
    });
  });
  await judge(attempt.id);
  return { drillId: drill.id, roundEnded: await openRoundAnswered(drill.node_id) };
}

/** Judges an attempt whose verdict failed earlier. 409 `already_judged` if it has one. */
export async function judgeAgain(attemptId: string): Promise<{ drillId: string; roundEnded: boolean }> {
  const { drill } = await drillElement(db, attemptId, "drill_attempt", "Attempt");
  const existing = await db.selectFrom("nodes").select("id").where("parent_id", "=", attemptId).where("kind", "=", "drill_verdict").executeTakeFirst();
  if (existing) throw new ConflictError("already_judged", "This attempt already has a verdict");
  await judge(attemptId);
  return { drillId: drill.id, roundEnded: await openRoundAnswered(drill.node_id) };
}
