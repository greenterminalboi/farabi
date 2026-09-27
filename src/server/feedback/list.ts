import type { Selectable } from "kysely";
import type { FeedbackItem } from "@/shared/schemas";
import { db as defaultDb, type DB } from "../db/client";
import type {
  FeedbackAttachmentsTable,
  FeedbackItemsTable,
  FeedbackStateEventsTable,
  FeedbackTagsTable,
} from "../db/schema";
import { NotFoundError } from "../errors";
import { assertId } from "../ids";
import { attachmentAbsPath, repoRelative } from "./paths";
import { SQL_EFFECTIVE_KEY } from "./rankKey";

const iso = (d: Date) => d.toISOString();

export function toFeedbackItem(
  item: Selectable<FeedbackItemsTable>,
  tags: Selectable<FeedbackTagsTable>[],
  attachments: Selectable<FeedbackAttachmentsTable>[],
  events: Selectable<FeedbackStateEventsTable>[],
): FeedbackItem {
  const history = events.map((e) => ({ state: e.state, provenance: e.provenance, at: iso(e.created_at) }));
  return {
    id: item.id,
    text: item.text,
    context: { view: item.view, nodeId: item.node_id },
    tags: tags.map((t) => ({ text: t.text, key: t.tag_key })),
    attachments: attachments.map((a) => ({
      id: a.id,
      url: `/api/feedback/attachments/${a.id}`,
      thumbUrl: `/api/feedback/attachments/${a.id}?thumb=1`,
      path: repoRelative(attachmentAbsPath(a.file_path)),
      mimeType: a.mime_type,
      byteSize: a.byte_size,
      createdAt: iso(a.created_at),
    })),
    state: history.at(-1)?.state ?? "open",
    history,
    manuallyPlaced: item.rank !== null,
    createdAt: iso(item.created_at),
  };
}

function groupBy<T extends { item_id: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.item_id);
    if (list) list.push(row);
    else map.set(row.item_id, [row]);
  }
  return map;
}

async function load(db: DB, onlyId?: string): Promise<FeedbackItem[]> {
  let itemsQuery = db
    .selectFrom("feedback_items")
    .selectAll()
    .orderBy(SQL_EFFECTIVE_KEY, "desc")
    .orderBy("id", "desc");
  if (onlyId) itemsQuery = itemsQuery.where("id", "=", onlyId);
  const items = await itemsQuery.execute();
  if (items.length === 0) return [];
  const ids = items.map((i) => i.id);
  const [tags, attachments, events] = await Promise.all([
    db
      .selectFrom("feedback_tags")
      .selectAll()
      .where("item_id", "in", ids)
      .orderBy("created_at")
      .orderBy("id")
      .execute(),
    db
      .selectFrom("feedback_attachments")
      .selectAll()
      .where("item_id", "in", ids)
      .orderBy("created_at")
      .orderBy("id")
      .execute(),
    db
      .selectFrom("feedback_state_events")
      .selectAll()
      .where("item_id", "in", ids)
      .orderBy("created_at")
      .orderBy("id")
      .execute(),
  ]);
  const byTags = groupBy(tags);
  const byAttachments = groupBy(attachments);
  const byEvents = groupBy(events);
  return items.map((i) =>
    toFeedbackItem(i, byTags.get(i.id) ?? [], byAttachments.get(i.id) ?? [], byEvents.get(i.id) ?? []),
  );
}

/** Every item in any state, in panel order (research R3). */
export function listFeedback(db: DB = defaultDb): Promise<FeedbackItem[]> {
  return load(db);
}

export async function getFeedbackItem(id: string, db: DB = defaultDb): Promise<FeedbackItem> {
  assertId(id, "Feedback item");
  const [item] = await load(db, id);
  if (!item) throw new NotFoundError("Feedback item not found");
  return item;
}
