// Hints, reveals, skips and flags (FR-014, FR-018, R9): rows only. Hints and solutions were written
// with their problem, so nothing here calls the AI.
import { db } from "../db/client";
import { ConflictError } from "../errors";
import { drillElement } from "./elements";
import { lockDrill } from "./state";

export type ProblemEvent = { type: "hint" | "reveal" | "skip" | "flag"; reason?: string };

/** Records an event on a problem. A repeated hint or reveal writes nothing new. */
export async function recordProblemEvent(problemId: string, event: ProblemEvent): Promise<string> {
  const { row, drill } = await drillElement(db, problemId, "drill_problem", "Problem");
  await db.transaction().execute(async (trx) => {
    await lockDrill(trx, drill.id);
    const earlier = await trx.selectFrom("drill_problem_events").select("type").where("problem_id", "=", row.id).execute();
    if (event.type === "flag" && earlier.some((e) => e.type === "flag")) throw new ConflictError("already_flagged", "This problem is already flagged");
    if ((event.type === "hint" || event.type === "reveal") && earlier.some((e) => e.type === event.type)) return;
    await trx
      .insertInto("drill_problem_events")
      .values({ problem_id: row.id, type: event.type, detail: JSON.stringify(event.type === "flag" && event.reason ? { reason: event.reason } : {}) })
      .execute();
  });
  return drill.id;
}
