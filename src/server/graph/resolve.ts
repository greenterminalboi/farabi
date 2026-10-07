// Old links keep working (research R18): an id is either a v2 element, or a v1 conversation that
// the converter turned into its first edge (recorded in the conversion ledger).
import { db } from "../db/client";

export async function resolveElementId(id: string): Promise<string | null> {
  const el = await db.selectFrom("nodes").select("id").where("id", "=", id).executeTakeFirst();
  if (el) return el.id;
  const ledger = await db
    .selectFrom("v1_conversion")
    .select("v2_id")
    .where("v1_table", "=", "nodes")
    .where("v1_id", "=", id)
    .where("v2_id", "is not", null)
    .orderBy("id")
    .limit(1)
    .executeTakeFirst();
  return ledger?.v2_id ?? null;
}
