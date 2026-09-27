// Background drafting of definitions (Feature 2, research R8). Same shape as the summary queue.
import { getAIProvider } from "../ai";
import { AIUnavailableError } from "../ai/provider";
import { db } from "../db/client";

const MAX_CONCURRENT = 2;

type QueueState = { queued: Set<string>; running: Set<string>; idle: Array<() => void> };
const g = globalThis as unknown as { __farabiDraftQueue?: QueueState };
g.__farabiDraftQueue ??= { queued: new Set(), running: new Set(), idle: [] };
const q = g.__farabiDraftQueue;

async function run(definitionId: string): Promise<void> {
  try {
    const def = await db.selectFrom("definitions").selectAll().where("id", "=", definitionId).executeTakeFirst();
    if (!def) return;
    const [source, messages] = await Promise.all([
      db.selectFrom("messages").select(["role", "content"]).where("id", "=", def.source_message_id).executeTakeFirstOrThrow(),
      // Only the source node's own messages, never inherited context (FR-029).
      db
        .selectFrom("messages")
        .select(["role", "content"])
        .where("node_id", "=", def.source_node_id)
        .where("status", "=", "complete")
        .where("replaced_at", "is", null)
        .orderBy("seq", "asc")
        .execute(),
    ]);
    const draft = await getAIProvider().define({ term: def.term, sourceMessage: source, messages });
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto("definition_versions")
        .values({
          definition_id: def.id,
          general_text: draft.general,
          usage_text: draft.usage,
          provenance: "ai_suggested",
        })
        .execute();
      await trx.updateTable("definitions").set({ draft_failed_at: null }).where("id", "=", def.id).execute();
    });
  } catch (err) {
    if (!(err instanceof AIUnavailableError)) console.error("definition draft failed", definitionId, err);
    await db
      .updateTable("definitions")
      .set({ draft_failed_at: new Date() })
      .where("id", "=", definitionId)
      .execute()
      .catch(() => undefined);
  }
}

function pump(): void {
  for (const id of q.queued) {
    if (q.running.size >= MAX_CONCURRENT) break;
    q.queued.delete(id);
    q.running.add(id);
    void run(id).finally(() => {
      q.running.delete(id);
      pump();
    });
  }
  if (q.queued.size === 0 && q.running.size === 0) for (const resolve of q.idle.splice(0)) resolve();
}

export function enqueueDraft(definitionId: string): void {
  q.queued.add(definitionId);
  queueMicrotask(pump);
}

export function isDrafting(definitionId: string): boolean {
  return q.queued.has(definitionId) || q.running.has(definitionId);
}

export function drainDrafts(): Promise<void> {
  if (q.queued.size === 0 && q.running.size === 0) return Promise.resolve();
  return new Promise((resolve) => q.idle.push(resolve));
}
