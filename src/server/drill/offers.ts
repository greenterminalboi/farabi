// The completion offer (FR-032, research R12): when a drill becomes complete, up to 3 starting
// points for new drills, chosen only from the drill's own follow-ups and branches and its attached
// conversations. Once per drill; it creates nothing by itself, and a dismissal is final.
import { sql } from "kysely";
import { AIUnavailableError } from "../ai/provider";
import { db } from "../db/client";
import { NotFoundError } from "../errors";
import { assertId } from "../ids";
import { attachedTexts } from "./attachments";
import { drillModel } from "./model";
import { callOperation, drillOffer, installDrillFakes } from "./operations";
import { latestLadder, loadDrillRow, lockDrill } from "./state";

/** Question edges that leave the drill's own text (follow-ups and branches), with their first answer. */
async function followUpTexts(drillNodeId: string): Promise<Array<{ nodeId: string; text: string }>> {
  const { rows } = await sql<{ id: string; text: string | null; answer: string | null }>`
    WITH RECURSIVE below AS (
      SELECT id, kind FROM nodes WHERE parent_id = ${drillNodeId}
      UNION ALL
      SELECT n.id, n.kind FROM nodes n JOIN below b ON n.parent_id = b.id WHERE b.kind LIKE 'drill\\_%'
    )
    SELECT q.id, q.text,
      (SELECT a.text FROM nodes a WHERE a.parent_id = q.id AND a.kind = 'answer' AND a.status = 'complete'
       ORDER BY a.created_at, a.id LIMIT 1) AS answer
    FROM nodes q JOIN below b ON b.id = q.id
    WHERE q.kind = 'question' AND q.text IS NOT NULL
    ORDER BY q.created_at, q.id`.execute(db);
  return rows.map((r) => ({ nodeId: r.id, text: [r.text, r.answer].filter(Boolean).join("\n\n") }));
}

/** Makes the drill's offer, once. No candidates, no picks or an AI failure leave no offer. */
export async function createOffer(drillId: string, roundId: string): Promise<void> {
  const drill = await loadDrillRow(db, drillId);
  const existing = await db.selectFrom("drill_offers").select("id").where("drill_id", "=", drill.id).executeTakeFirst();
  if (existing) return;
  const [follow, attached, ladder] = await Promise.all([followUpTexts(drill.node_id), attachedTexts(drill.id), latestLadder(db, drill.id)]);
  const seen = new Set<string>();
  const candidates = [...follow, ...attached].filter((c) => !seen.has(c.nodeId) && seen.add(c.nodeId));
  if (candidates.length === 0) return;
  installDrillFakes();
  let picks;
  try {
    ({ picks } = await callOperation(
      drillOffer,
      { domain: drill.domain, ladder: ladder.rungs.filter((r) => !r.removed).map((r) => r.name), candidates },
      { model: await drillModel() },
    ));
  } catch (err) {
    if (err instanceof AIUnavailableError) {
      console.warn("The drill offer couldn't be made:", err.message);
      return;
    }
    throw err;
  }
  if (picks.length === 0) return;
  await db.transaction().execute(async (trx) => {
    await lockDrill(trx, drill.id);
    const again = await trx.selectFrom("drill_offers").select("id").where("drill_id", "=", drill.id).executeTakeFirst();
    if (again) return;
    await trx
      .insertInto("drill_offers")
      .values({
        drill_id: drill.id,
        round_id: roundId,
        candidates: JSON.stringify(picks),
        function_id: drillOffer.id,
        function_version: drillOffer.version,
      })
      .execute();
  });
}

/** Hides the offer for good (FR-032). Returns its drill. */
export async function dismissOffer(offerId: string): Promise<string> {
  assertId(offerId, "Offer");
  const offer = await db.selectFrom("drill_offers").select(["id", "drill_id"]).where("id", "=", offerId).executeTakeFirst();
  if (!offer) throw new NotFoundError("Offer not found");
  await db.transaction().execute(async (trx) => {
    await lockDrill(trx, offer.drill_id);
    const done = await trx.selectFrom("drill_offer_events").select("id").where("offer_id", "=", offer.id).where("type", "=", "dismissed").executeTakeFirst();
    if (!done) await trx.insertInto("drill_offer_events").values({ offer_id: offer.id, type: "dismissed" }).execute();
  });
  return offer.drill_id;
}
