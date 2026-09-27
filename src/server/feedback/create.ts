import { randomUUID } from "node:crypto";
import { type FeedbackItem, FeedbackCreateFields } from "@/shared/schemas";
import { termKey } from "@/shared/termKey";
import { db } from "../db/client";
import { InvalidRequestError } from "../errors";
import { removeUncommittedFiles, type Upload, validateUploads, writeAttachmentFiles } from "./attachments";
import { afterFeedbackWrite } from "./exportFile";
import { getFeedbackItem } from "./list";

/**
 * Stores a new feedback item with its tags, screenshots and first `open` state event, all in one
 * transaction (FR-003 – FR-006). No AI is involved (FR-021).
 */
export async function createFeedback(input: FeedbackCreateFields, uploads: Upload[] = []): Promise<FeedbackItem> {
  const fields = FeedbackCreateFields.parse(input);
  if (fields.nodeId) {
    const node = await db.selectFrom("nodes").select("id").where("id", "=", fields.nodeId).executeTakeFirst();
    if (!node) throw new InvalidRequestError("That conversation does not exist");
  }
  const tags = new Map<string, string>();
  for (const tag of fields.tags) {
    const key = termKey(tag);
    if (!tags.has(key)) tags.set(key, tag.trim().replace(/\s+/g, " "));
  }
  const images = validateUploads(uploads);

  const id = randomUUID();
  const written: string[] = [];
  try {
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto("feedback_items")
        .values({ id, text: fields.text.trim(), view: fields.view, node_id: fields.nodeId, provenance: "user_authored" })
        .execute();
      for (const [key, text] of tags) {
        await trx.insertInto("feedback_tags").values({ item_id: id, text, tag_key: key, provenance: "user_authored" }).execute();
      }
      await trx
        .insertInto("feedback_state_events")
        .values({ item_id: id, state: "open", provenance: "user_authored" })
        .execute();
      const rows = await writeAttachmentFiles(id, images, written);
      for (const row of rows) {
        await trx.insertInto("feedback_attachments").values({ ...row, item_id: id, provenance: "user_authored" }).execute();
      }
    });
  } catch (err) {
    await removeUncommittedFiles(written);
    throw err;
  }
  await afterFeedbackWrite();
  return getFeedbackItem(id);
}
