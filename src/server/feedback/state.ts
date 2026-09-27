import type { FeedbackItem, FeedbackState } from "@/shared/schemas";
import { db as defaultDb, type DB, type Trx } from "../db/client";
import { ConflictError, NotFoundError } from "../errors";
import { assertId } from "../ids";
import { afterFeedbackWrite } from "./exportFile";
import { getFeedbackItem } from "./list";

// State transitions (research R9). Each one locks the item row, reads the latest event and appends
// a new one; nothing is ever updated or removed (FR-016).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The current state with the item row locked, or null if there is no such item. */
async function lockedState(trx: Trx, id: string): Promise<FeedbackState | null> {
  const item = await trx.selectFrom("feedback_items").select("id").where("id", "=", id).forUpdate().executeTakeFirst();
  if (!item) return null;
  const latest = await trx
    .selectFrom("feedback_state_events")
    .select("state")
    .where("item_id", "=", id)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  return latest?.state ?? "open";
}

export type MarkAddressedResult = "addressed" | "not_open" | "not_found";

/**
 * The only way anything becomes `addressed`, used by `npm run feedback:addressed` (FR-019, FR-020):
 * `open` → `addressed` (ai_suggested); any other state is left alone.
 */
export async function markAddressed(id: string, db: DB = defaultDb): Promise<MarkAddressedResult> {
  if (!UUID.test(id)) return "not_found";
  const result = await db.transaction().execute(async (trx): Promise<MarkAddressedResult> => {
    const state = await lockedState(trx, id);
    if (state === null) return "not_found";
    if (state !== "open") return "not_open";
    await trx
      .insertInto("feedback_state_events")
      .values({ item_id: id, state: "addressed", provenance: "ai_suggested" })
      .execute();
    return "addressed";
  });
  if (result === "addressed") await afterFeedbackWrite(db);
  return result;
}

/** The current state of an item, for the script's messages. */
export async function currentState(id: string, db: DB = defaultDb): Promise<FeedbackState | null> {
  if (!UUID.test(id)) return null;
  return db.transaction().execute((trx) => lockedState(trx, id));
}

async function userTransition(
  id: string,
  allowedFrom: FeedbackState[],
  to: "open" | "resolved",
): Promise<FeedbackItem> {
  assertId(id, "Feedback item");
  await defaultDb.transaction().execute(async (trx) => {
    const state = await lockedState(trx, id);
    if (state === null) throw new NotFoundError("Feedback item not found");
    if (!allowedFrom.includes(state)) {
      throw new ConflictError("invalid_transition", `This item is already ${state}`);
    }
    await trx
      .insertInto("feedback_state_events")
      .values({ item_id: id, state: to, provenance: to === "resolved" ? "user_confirmed" : "user_authored" })
      .execute();
  });
  await afterFeedbackWrite();
  return getFeedbackItem(id);
}

/** The user confirms an item as done, from `open` or `addressed` (FR-013, FR-014). */
export function resolveFeedback(id: string): Promise<FeedbackItem> {
  return userTransition(id, ["open", "addressed"], "resolved");
}

/** The user reopens an item, from `addressed` or `resolved` (FR-015). */
export function reopenFeedback(id: string): Promise<FeedbackItem> {
  return userTransition(id, ["addressed", "resolved"], "open");
}
