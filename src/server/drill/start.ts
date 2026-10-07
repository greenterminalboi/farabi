// Starting a drill (FR-005, FR-006): confirm the ladder, open rung 1 at level 1 with the rest
// locked, then generate round 1 with rung 1's lesson.
import { db } from "../db/client";
import { ConflictError } from "../errors";
import { generateRoundAfter } from "./rounds";
import { latestLadder, lockDrill } from "./state";

/** Starts a drill. Returns the round generation's failure, if any; the start itself stays. */
export async function startDrill(drillId: string): Promise<{ code: string; message: string } | undefined> {
  await db.transaction().execute(async (trx) => {
    const drill = await lockDrill(trx, drillId);
    if (drill.started_at !== null) throw new ConflictError("already_started", "This drill has already started");
    const ladder = await latestLadder(trx, drill.id);
    const live = ladder.rungs.filter((r) => !r.removed);
    if (live.length === 0) throw new ConflictError("empty_ladder", "Add at least one rung first");
    // Starting with the proposal as it is confirms it (data-model.md "drill_ladder_versions").
    if (ladder.provenance === "ai_suggested") {
      const confirmed = ladder.rungs.map((r) => ({ ...r, provenance: r.provenance === "ai_suggested" ? ("user_confirmed" as const) : r.provenance }));
      await trx
        .insertInto("drill_ladder_versions")
        .values({ drill_id: drill.id, rungs: JSON.stringify(confirmed), provenance: "user_confirmed" })
        .execute();
    }
    await trx
      .insertInto("drill_level_changes")
      .values(
        live.map((r, i) => ({
          drill_id: drill.id,
          rung_id: r.id,
          to_level: 1,
          to_state: i === 0 ? ("open" as const) : ("locked" as const),
          cause: "start" as const,
          provenance: "ai_suggested" as const,
        })),
      )
      .execute();
    await trx.updateTable("drills").set({ started_at: new Date() }).where("id", "=", drill.id).execute();
  });
  return generateRoundAfter(drillId);
}
