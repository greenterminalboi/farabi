// Editing the ladder (FR-002): every save writes the whole ordered list as a new user-authored
// version. Rung ids stay the same across versions; a removed rung stays, marked removed.
import { randomUUID } from "node:crypto";
import { db } from "../db/client";
import type { StoredRung } from "../db/schema";
import { ConflictError, InvalidRequestError } from "../errors";
import { currentLevels, latestLadder, lockDrill, roundRows } from "./state";

export const MAX_RUNGS = 20;
export const MAX_RUNG_NAME = 120;

export type RungEdit = { id?: string; name: string; removed?: boolean };

/**
 * Saves a ladder edit. Rungs left out of the list are kept as removed, after the others. Once
 * rounds exist, open and solid rungs keep their order; only locked rungs can be reordered (edge
 * case). On a started drill, a new rung gets a `start` change as locked, which reopens a complete
 * drill (FR-032).
 */
export async function saveLadder(drillId: string, edits: RungEdit[]): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const drill = await lockDrill(trx, drillId);
    const current = await latestLadder(trx, drill.id);
    const known = new Map(current.rungs.map((r) => [r.id, r]));
    const seen = new Set<string>();

    const next: StoredRung[] = edits.map((e) => {
      const name = e.name.trim().replace(/\s+/g, " ");
      if (name.length < 1 || name.length > MAX_RUNG_NAME) throw new InvalidRequestError(`A rung name is 1 to ${MAX_RUNG_NAME} characters`);
      if (e.id !== undefined) {
        if (!known.has(e.id)) throw new InvalidRequestError("Unknown rung");
        if (seen.has(e.id)) throw new InvalidRequestError("A rung appears twice");
        seen.add(e.id);
        const before = known.get(e.id)!;
        const removed = e.removed ?? false;
        const same = before.name === name && before.removed === removed;
        return { id: e.id, name, removed, provenance: same ? before.provenance : "user_authored" };
      }
      return { id: randomUUID(), name, removed: e.removed ?? false, provenance: "user_authored" };
    });
    for (const r of current.rungs) if (!seen.has(r.id)) next.push({ ...r, removed: true });

    const live = next.filter((r) => !r.removed).length;
    if (live < 1 || live > MAX_RUNGS) throw new InvalidRequestError(`A ladder has 1 to ${MAX_RUNGS} rungs`);

    const levels = await currentLevels(trx, drill.id);
    if ((await roundRows(trx, drill)).length > 0) {
      const ordered = (rungs: StoredRung[]) => rungs.filter((r) => levels.has(r.id) && levels.get(r.id)!.state !== "locked").map((r) => r.id);
      const before = ordered(current.rungs);
      const after = ordered(next).filter((id) => before.includes(id));
      if (after.join() !== before.filter((id) => after.includes(id)).join()) {
        throw new ConflictError("ladder_order_locked", "Open and solid rungs keep their order; only locked rungs can move");
      }
    }

    await trx.insertInto("drill_ladder_versions").values({ drill_id: drill.id, rungs: JSON.stringify(next), provenance: "user_authored" }).execute();
    if (drill.started_at !== null) {
      const added = next.filter((r) => !known.has(r.id) && !r.removed);
      if (added.length) {
        await trx
          .insertInto("drill_level_changes")
          .values(
            added.map((r) => ({
              drill_id: drill.id,
              rung_id: r.id,
              to_level: 1,
              to_state: "locked" as const,
              cause: "start" as const,
              provenance: "ai_suggested" as const,
            })),
          )
          .execute();
      }
    }
  });
}
