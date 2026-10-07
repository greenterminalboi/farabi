// Finding a drill element and the drill it belongs to, by walking up its fixed tree shape (R2).
import type { Selectable } from "kysely";
import type { DB, Trx } from "../db/client";
import type { NodesTable } from "../db/schema";
import { NotFoundError } from "../errors";
import { loadLive } from "../graph/elements";
import { assertId } from "../ids";
import type { DrillRow } from "./state";

type Q = DB | Trx;
type Row = Selectable<NodesTable>;

/** Levels above each kind to its drill node: problem → round → drill, and so on. */
const DEPTH: Record<string, number> = { drill_round: 1, drill_problem: 2, drill_lesson: 2, drill_attempt: 3, drill_verdict: 4 };

/** A drill element of `kind` in a live project, with its drill; 404 otherwise. */
export async function drillElement(q: Q, id: string, kind: keyof typeof DEPTH, what: string): Promise<{ row: Row; drill: DrillRow }> {
  assertId(id, what);
  const row = await loadLive(q, id).catch(() => null);
  if (!row || row.kind !== kind) throw new NotFoundError(`${what} not found`);
  let nodeId = row.id;
  for (let i = 0; i < DEPTH[kind]; i++) {
    const up = await q.selectFrom("nodes").select("parent_id").where("id", "=", nodeId).executeTakeFirstOrThrow();
    nodeId = up.parent_id!;
  }
  const drill = await q.selectFrom("drills").selectAll().where("node_id", "=", nodeId).executeTakeFirst();
  if (!drill) throw new NotFoundError(`${what} not found`);
  return { row, drill };
}
