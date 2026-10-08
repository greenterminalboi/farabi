// Setting a rung's level or state by hand (FR-021): a user-authored `manual` change.
import { db } from "../db/client";
import { ConflictError, NotFoundError } from "../errors";
import type { RungState } from "./progression";
import { currentLevels, latestLadder, lockDrill } from "./state";

export async function setLevel(drillId: string, rungId: string, to: { level?: number; state?: RungState }): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const drill = await lockDrill(trx, drillId);
    if (drill.started_at === null) throw new ConflictError("not_started", "Start the drill first");
    const ladder = await latestLadder(trx, drill.id);
    const rung = ladder.rungs.find((r) => r.id === rungId && !r.removed);
    if (!rung) throw new NotFoundError("Rung not found");
    const now = (await currentLevels(trx, drill.id)).get(rungId) ?? { level: 1, state: "locked" as const };
    const level = to.level ?? now.level;
    const state = to.state ?? now.state;
    if (level === now.level && state === now.state) return;
    await trx
      .insertInto("drill_level_changes")
      .values({
        drill_id: drill.id,
        rung_id: rungId,
        from_level: now.level,
        to_level: level,
        from_state: now.state,
        to_state: state,
        cause: "manual",
        provenance: "user_authored",
      })
      .execute();
  });
}
