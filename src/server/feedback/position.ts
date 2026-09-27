import type { FeedbackItem } from "@/shared/schemas";
import { db } from "../db/client";
import { InvalidRequestError, NotFoundError } from "../errors";
import { assertId } from "../ids";
import { afterFeedbackWrite } from "./exportFile";
import { getFeedbackItem } from "./list";
import { effectiveKey, keyBetween } from "./rankKey";

async function keyOf(id: string): Promise<string> {
  assertId(id, "Feedback item");
  const row = await db
    .selectFrom("feedback_items")
    .select(["rank", "created_at"])
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) throw new NotFoundError("Feedback item not found");
  return effectiveKey(row);
}

/**
 * Moves an item between the two items shown directly above and below the drop point. Only this
 * item's `rank` changes; no other item's stored position is touched (FR-009, SC-006).
 */
export async function moveFeedback(id: string, aboveId: string | null, belowId: string | null): Promise<FeedbackItem> {
  await keyOf(id);
  if (aboveId === id || belowId === id) throw new InvalidRequestError("An item cannot be its own neighbour");
  if (aboveId === null && belowId === null) throw new InvalidRequestError("A neighbour is needed");
  const hi = aboveId ? await keyOf(aboveId) : null;
  const lo = belowId ? await keyOf(belowId) : null;
  if (hi !== null && lo !== null && hi < lo) {
    throw new InvalidRequestError("The item above must sort above the item below");
  }
  await db.updateTable("feedback_items").set({ rank: keyBetween(lo, hi) }).where("id", "=", id).execute();
  await afterFeedbackWrite();
  return getFeedbackItem(id);
}
