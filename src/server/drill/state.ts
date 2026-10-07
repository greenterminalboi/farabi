// Reading a drill's current state (data-model.md): its row, the newest ladder version, each rung's
// newest level change and its settings. Shared by the services; nothing here writes.
import { sql } from "kysely";
import { db, type DB, type Trx } from "../db/client";
import type { DrillsTable, StoredRung } from "../db/schema";
import { NotFoundError } from "../errors";
import { assertId } from "../ids";
import { resolvedValues } from "../settings/kindSettings";
import type { DrillSettings, LadderRung, RungLevel } from "./progression";
import type { Selectable } from "kysely";

type Q = DB | Trx;
export type DrillRow = Selectable<DrillsTable>;

/** A drill in a live project; 404 otherwise (FR-029). */
export async function loadDrillRow(q: Q, drillId: string): Promise<DrillRow> {
  assertId(drillId, "Drill");
  const row = await q
    .selectFrom("drills")
    .innerJoin("projects", "projects.id", "drills.project_id")
    .selectAll("drills")
    .where("drills.id", "=", drillId)
    .where("projects.trashed_at", "is", null)
    .executeTakeFirst();
  if (!row) throw new NotFoundError("Drill not found");
  return row;
}

/** Locks the drill row for the rest of the transaction, so its rounds and levels change one at a time. */
export async function lockDrill(trx: Trx, drillId: string): Promise<DrillRow> {
  await loadDrillRow(trx, drillId);
  return trx.selectFrom("drills").selectAll().where("id", "=", drillId).forUpdate().executeTakeFirstOrThrow();
}

export type LadderVersion = { id: string; provenance: DrillRow["domain_provenance"]; rungs: StoredRung[] };

/** The ladder: the newest version (FR-002). */
export async function latestLadder(q: Q, drillId: string): Promise<LadderVersion> {
  const row = await q
    .selectFrom("drill_ladder_versions")
    .select(["id", "provenance", "rungs"])
    .where("drill_id", "=", drillId)
    .orderBy("seq", "desc")
    .limit(1)
    .executeTakeFirstOrThrow();
  return row;
}

export const asLadder = (rungs: StoredRung[]): LadderRung[] => rungs.map((r) => ({ id: r.id, name: r.name, removed: r.removed }));

export type CurrentLevel = RungLevel & { changeId: string };

/** Each rung's newest level change (FR-005). Rungs with none yet are absent. */
export async function currentLevels(q: Q, drillId: string): Promise<Map<string, CurrentLevel>> {
  const { rows } = await sql<{ id: string; rung_id: string; to_level: number; to_state: RungLevel["state"] }>`
    SELECT DISTINCT ON (rung_id) id, rung_id, to_level, to_state
    FROM drill_level_changes WHERE drill_id = ${drillId}
    ORDER BY rung_id, seq DESC`.execute(q);
  return new Map(rows.map((r) => [r.rung_id, { level: r.to_level, state: r.to_state, changeId: r.id }]));
}

/** The drill's settings: its own overrides, then the kind values, then the defaults (R10, C6). */
export async function drillSettings(drill: Pick<DrillRow, "node_id">): Promise<DrillSettings & { raw: Record<string, string> }> {
  const raw = await resolvedValues("drill", drill.node_id);
  return {
    roundSize: Number(raw.round_size),
    openLevel: Number(raw.open_level),
    solidLevel: Number(raw.solid_level),
    raw,
  };
}

/** A round's number, its explicit order (R2). */
export const roundNumber = (row: { properties: Record<string, unknown> }) => (row.properties as { number: number }).number;

/** The drill's round edges, in round order. */
export async function roundRows(q: Q, drill: Pick<DrillRow, "node_id">) {
  const rows = await q.selectFrom("nodes").selectAll().where("parent_id", "=", drill.node_id).where("kind", "=", "drill_round").execute();
  return rows.sort((a, b) => roundNumber(a) - roundNumber(b));
}

/** The open round: the newest round with no end row, if any. */
export async function openRound(q: Q, drill: Pick<DrillRow, "node_id">) {
  const rounds = await roundRows(q, drill);
  const last = rounds.at(-1);
  if (!last) return null;
  const ended = await q.selectFrom("drill_round_ends").select("round_id").where("round_id", "=", last.id).executeTakeFirst();
  return ended ? null : last;
}

export { db };
