// Runs AI replies in the background, apart from any HTTP request (Feature 2, research R2).
// The reply's text is kept in memory while it streams, checkpointed to `partial_content` about
// once a second, and written to `content` exactly once, when the reply ends.
import type { Selectable } from "kysely";
import type { Message } from "@/shared/schemas";
import { getAIProvider } from "../ai";
import { AIPartialReplyError, AIUnavailableError, isAbortError, type ReplyInput } from "../ai/provider";
import { db } from "../db/client";
import type { MessagesTable, MessageStatus } from "../db/schema";
import { toMessage } from "../mappers";
import { summaryAfterReply } from "../summaries/queue";

const CHECKPOINT_MS = 1000;

export type GenerationEvent = { type: "delta"; text: string } | { type: "end"; message: Message };

type Generation = {
  nodeId: string;
  buffer: string;
  listeners: Set<(event: GenerationEvent) => void>;
  abort: AbortController;
  done: Promise<Message>;
  lastCheckpoint: number;
};

const g = globalThis as unknown as { __farabiGenerations?: Map<string, Generation> };
g.__farabiGenerations ??= new Map();
const live = g.__farabiGenerations;

async function finalize(messageId: string, status: MessageStatus, content: string): Promise<Message | null> {
  const row = await db
    .updateTable("messages")
    .set({ status, content, partial_content: null })
    .where("id", "=", messageId)
    .where("status", "=", "pending")
    .returningAll()
    .executeTakeFirst();
  if (row) return toMessage(row);
  // Already finalised elsewhere (e.g. as an orphan): return what is stored, or null if it's gone.
  const stored = await db.selectFrom("messages").selectAll().where("id", "=", messageId).executeTakeFirst();
  return stored ? toMessage(stored) : null;
}

function checkpoint(messageId: string, gen: Generation): void {
  const now = Date.now();
  if (now - gen.lastCheckpoint < CHECKPOINT_MS) return;
  gen.lastCheckpoint = now;
  void db
    .updateTable("messages")
    .set({ partial_content: gen.buffer })
    .where("id", "=", messageId)
    .where("status", "=", "pending")
    .execute()
    .catch((err) => console.error("checkpoint failed", err));
}

/**
 * Starts generating the reply for a pending AI message. Registration is synchronous, so the
 * message is never seen as an orphan once this returns.
 */
export function startGeneration(
  nodeId: string,
  messageId: string,
  buildInput: () => Promise<ReplyInput>,
): Promise<Message> {
  const existing = live.get(messageId);
  if (existing) return existing.done;

  const gen: Generation = {
    nodeId,
    buffer: "",
    listeners: new Set(),
    abort: new AbortController(),
    done: Promise.resolve(null as unknown as Message),
    lastCheckpoint: Date.now(),
  };
  live.set(messageId, gen);

  gen.done = (async () => {
    let status: MessageStatus;
    let content: string;
    try {
      const input = await buildInput();
      content = await getAIProvider().reply(
        { ...input, signal: gen.abort.signal },
        {
          onText: (delta) => {
            gen.buffer += delta;
            for (const listener of gen.listeners) listener({ type: "delta", text: delta });
            checkpoint(messageId, gen);
          },
        },
      );
      status = "complete";
    } catch (err) {
      if (isAbortError(err) || gen.abort.signal.aborted) {
        status = "stopped";
        content = gen.buffer;
      } else if (err instanceof AIPartialReplyError || (err instanceof AIUnavailableError && gen.buffer)) {
        status = "incomplete";
        content = gen.buffer || (err as AIPartialReplyError).partial || "";
      } else {
        if (!(err instanceof AIUnavailableError)) console.error("reply failed", err);
        status = gen.buffer ? "incomplete" : "failed";
        content = gen.buffer;
      }
    }
    let message: Message | null = null;
    try {
      message = await finalize(messageId, status, content);
    } catch (err) {
      console.error("couldn't store the reply", messageId, err);
    }
    live.delete(messageId);
    if (message) {
      for (const listener of gen.listeners) listener({ type: "end", message });
      if (status === "complete") summaryAfterReply(nodeId);
    }
    return message as Message;
  })();
  return gen.done;
}

/** Subscribes to a live generation. Returns null when the message isn't generating. */
export function subscribe(
  messageId: string,
  listener: (event: GenerationEvent) => void,
): { snapshot: string; unsubscribe: () => void } | null {
  const gen = live.get(messageId);
  if (!gen) return null;
  gen.listeners.add(listener);
  return { snapshot: gen.buffer, unsubscribe: () => gen.listeners.delete(listener) };
}

export function isGenerating(messageId: string): boolean {
  return live.has(messageId);
}

/** Stops a live generation; resolves with the finalised (stopped) message. */
export async function stopGeneration(messageId: string): Promise<Message | null> {
  const gen = live.get(messageId);
  if (!gen) return null;
  gen.abort.abort();
  return gen.done;
}

/** Resolves when the reply has ended (for ?wait=1 and tests). */
export async function waitFor(messageId: string): Promise<Message> {
  const gen = live.get(messageId);
  if (gen) return gen.done;
  const row = await db.selectFrom("messages").selectAll().where("id", "=", messageId).executeTakeFirstOrThrow();
  return toMessage(await finalizeOrphan(row));
}

/**
 * A pending message with no live generator (the server restarted mid-reply) becomes incomplete,
 * keeping its last checkpoint (SC-003).
 */
export async function finalizeOrphan(row: Selectable<MessagesTable>): Promise<Selectable<MessagesTable>> {
  if (row.status !== "pending" || live.has(row.id)) return row;
  const updated = await db
    .updateTable("messages")
    .set({ status: "incomplete", content: row.partial_content ?? "", partial_content: null })
    .where("id", "=", row.id)
    .where("status", "=", "pending")
    .returningAll()
    .executeTakeFirst();
  return updated ?? (await db.selectFrom("messages").selectAll().where("id", "=", row.id).executeTakeFirstOrThrow());
}

/** Resolves once no generation is running (tests). */
export async function drainGenerations(): Promise<void> {
  while (live.size > 0) await Promise.allSettled([...live.values()].map((gen) => gen.done));
}
