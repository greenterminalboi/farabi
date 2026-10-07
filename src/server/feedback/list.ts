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
import { excerptOf } from "../definitions/list";
import { assertId } from "../ids";
import { attachmentAbsPath, repoRelative } from "./paths";
import { SQL_EFFECTIVE_KEY } from "./rankKey";

const iso = (d: Date) => d.toISOString();

type ItemRow = Selectable<FeedbackItemsTable> & { element_kind: string | null; element_text: string | null };

export function toFeedbackItem(
  item: ItemRow,
  tags: Selectable<FeedbackTagsTable>[],
  attachments: Selectable<FeedbackAttachmentsTable>[],
  events: Selectable<FeedbackStateEventsTable>[],
): FeedbackItem {
  const history = events.map((e) => ({ state: e.state, provenance: e.provenance, at: iso(e.created_at) }));
  return {
    id: item.id,
    text: item.text,
    context: {
      view: item.view,
      nodeId: item.node_id,
      projectId: item.project_id,
      elementId: item.element_id,
      element: item.element_kind ? { kind: item.element_kind, excerpt: excerptOf(item.element_text) } : null,
    },
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
    .leftJoin("nodes", "nodes.id", "feedback_items.element_id")
    .selectAll("feedback_items")
    .select(["nodes.kind as element_kind", "nodes.text as element_text"])
    .orderBy(SQL_EFFECTIVE_KEY, "desc")
    .orderBy("feedback_items.id", "desc");
  if (onlyId) itemsQuery = itemsQuery.where("feedback_items.id", "=", onlyId);
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
