// Runs AI replies in the background, apart from any HTTP request (Feature 2, research R13), keyed
// by answer id. The reply's text is kept in memory while it streams, checkpointed to
// `partial_text` about once a second, and written to `text` exactly once, when the reply ends
// (nodes_guard's checkpoint and finalize paths).
import type { Element, ElementOrigin } from "@/shared/schemas";
import { getAIProvider, resolveReplyModel } from "../ai";
import { AIPartialReplyError, AIUnavailableError, isAbortError, type ReplyInput } from "../ai/provider";
import { db, type Trx } from "../db/client";
import type { AnswerStatus } from "../db/schema";
import { type ElementRow, insertElement, toElement } from "../graph/elements";
import { currentUses, lexiconProperties, usesOf } from "../lexicon/resolve";
import { getSettings } from "../settings/settings";

const CHECKPOINT_MS = 1000;

export type GenerationEvent = { type: "delta"; text: string } | { type: "end"; answer: Element };

type Generation = {
  buffer: string;
  listeners: Set<(event: GenerationEvent) => void>;
  abort: AbortController;
  done: Promise<Element>;
  lastCheckpoint: number;
};

const g = globalThis as unknown as { __farabiGenerations?: Map<string, Generation> };
g.__farabiGenerations ??= new Map();
const live = g.__farabiGenerations;

/**
 * Inserts a pending answer under a sent question edge. It records the level and model in effect
 * right now, so the reply keeps them whatever changes later (Feature 6), and the lexicon terms it
 * is sent (Feature 13). The only place answers are created.
 */
export async function insertPendingAnswer(
  trx: Trx,
  edge: Pick<ElementRow, "id" | "tree_id" | "project_id" | "properties">,
  origin: Extract<ElementOrigin, "reply" | "retry" | "regenerate">,
): Promise<ElementRow> {
  const settings = await getSettings(trx);
  // The lexicon terms this reply will be sent: the edge's, at their current versions (FR-014).
  const lexicon = currentUses(usesOf(edge.properties));
  return insertElement(trx, {
    kind: "answer",
    parentId: edge.id,
    treeId: edge.tree_id,
    projectId: edge.project_id,
    origin,
    provenance: "ai_suggested",
    text: "",
    status: "pending",
    pressureLevel: settings.informationPressure,
    replyModel: resolveReplyModel(settings.replyModel),
    properties: lexiconProperties(lexicon),
  });
}

async function finalize(answerId: string, status: AnswerStatus, text: string): Promise<Element | null> {
  const row = await db
    .updateTable("nodes")
    .set({ status, text, partial_text: null })
    .where("id", "=", answerId)
    .where("status", "=", "pending")
    .returningAll()
    .executeTakeFirst();
  if (row) return toElement(row);
  // Already finalized elsewhere (e.g. as an orphan): return what is stored.
  const stored = await db.selectFrom("nodes").selectAll().where("id", "=", answerId).executeTakeFirst();
  return stored ? toElement(stored) : null;
}

function checkpoint(answerId: string, gen: Generation): void {
  const now = Date.now();
  if (now - gen.lastCheckpoint < CHECKPOINT_MS) return;
  gen.lastCheckpoint = now;
  void db
    .updateTable("nodes")
    .set({ partial_text: gen.buffer })
    .where("id", "=", answerId)
    .where("status", "=", "pending")
    .execute()
    .catch((err) => console.error("checkpoint failed", err));
}

/**
 * Starts generating a pending answer. Registration is synchronous, so the answer is never seen as
 * an orphan once this returns.
 */
export function startGeneration(answerId: string, buildInput: () => Promise<ReplyInput>): Promise<Element> {
  const existing = live.get(answerId);
  if (existing) return existing.done;

  const gen: Generation = {
    buffer: "",
    listeners: new Set(),
    abort: new AbortController(),
    done: Promise.resolve(null as unknown as Element),
    lastCheckpoint: Date.now(),
  };
  live.set(answerId, gen);

  gen.done = (async () => {
    let status: AnswerStatus;
    let text: string;
    try {
      const input = await buildInput();
      text = await getAIProvider().reply(
        { ...input, signal: gen.abort.signal },
        {
          onText: (delta) => {
            gen.buffer += delta;
            for (const listener of gen.listeners) listener({ type: "delta", text: delta });
            checkpoint(answerId, gen);
          },
        },
      );
      status = "complete";
    } catch (err) {
      if (isAbortError(err) || gen.abort.signal.aborted) {
        status = "stopped";
        text = gen.buffer;
      } else if (err instanceof AIPartialReplyError || (err instanceof AIUnavailableError && gen.buffer)) {
        status = "incomplete";
        text = gen.buffer || (err as AIPartialReplyError).partial || "";
      } else {
        if (!(err instanceof AIUnavailableError)) console.error("reply failed", err);
        status = gen.buffer ? "incomplete" : "failed";
        text = gen.buffer;
      }
    }
    let answer: Element | null = null;
    try {
      answer = await finalize(answerId, status, text);
    } catch (err) {
      console.error("couldn't store the reply", answerId, err);
    }
    live.delete(answerId);
    if (answer) for (const listener of gen.listeners) listener({ type: "end", answer });
    return answer as Element;
  })();
  return gen.done;
}

/** Subscribes to a live generation. Returns null when the answer isn't generating. */
export function subscribe(
  answerId: string,
  listener: (event: GenerationEvent) => void,
): { snapshot: string; unsubscribe: () => void } | null {
  const gen = live.get(answerId);
  if (!gen) return null;
  gen.listeners.add(listener);
  return { snapshot: gen.buffer, unsubscribe: () => gen.listeners.delete(listener) };
}

export function isGenerating(answerId: string): boolean {
  return live.has(answerId);
}

/** Stops a live generation; resolves with the finalized (stopped) answer. */
export async function stopGeneration(answerId: string): Promise<Element | null> {
  const gen = live.get(answerId);
  if (!gen) return null;
  gen.abort.abort();
  return gen.done;
}

/** Resolves when the reply has ended (for ?wait=1 and tests). */
export async function waitFor(answerId: string): Promise<Element> {
  const gen = live.get(answerId);
  if (gen) return gen.done;
  const row = await db.selectFrom("nodes").selectAll().where("id", "=", answerId).executeTakeFirstOrThrow();
  return toElement(await finalizeOrphan(row));
}

/**
 * A pending answer with no live generator (the server restarted mid-reply) becomes incomplete,
 * keeping its last checkpoint (Feature 2 orphan rule).
 */
export async function finalizeOrphan(row: ElementRow): Promise<ElementRow> {
  if (row.status !== "pending" || live.has(row.id)) return row;
  const updated = await db
    .updateTable("nodes")
    .set({ status: "incomplete", text: row.partial_text ?? "", partial_text: null })
    .where("id", "=", row.id)
    .where("status", "=", "pending")
    .returningAll()
    .executeTakeFirst();
  return updated ?? (await db.selectFrom("nodes").selectAll().where("id", "=", row.id).executeTakeFirstOrThrow());
}

/**
 * Stops every live reply the way Stop does (the text so far is kept) and waits up to `timeoutMs`
 * for them to finalize. Used when the desktop app quits (feature 11, data-model.md §6).
 */
export async function stopAllGenerations(timeoutMs = 3000): Promise<void> {
  const all = [...live.values()];
  for (const gen of all) gen.abort.abort();
  await Promise.race([Promise.allSettled(all.map((gen) => gen.done)), new Promise((r) => setTimeout(r, timeoutMs))]);
}

/** Resolves once no generation is running (tests). */
export async function drainGenerations(): Promise<void> {
  while (live.size > 0) await Promise.allSettled([...live.values()].map((gen) => gen.done));
}
