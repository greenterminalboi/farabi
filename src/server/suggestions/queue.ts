// Background analysis of completed AI replies for suggested branch spans (Feature 5, research R4).
// Same in-process shape as the summary and definition queues. Results go only to the hidden
// span_suggestions cache; failures leave nothing behind and cool down for a while (research R5).
import { getAIProvider } from "../ai";
import { SPAN_DETECTOR_VERSION } from "../ai/claudePrompts";
import { AIUnavailableError } from "../ai/provider";
import { db } from "../db/client";
import { locateSpans } from "./locate";

const MAX_CONCURRENT = 2;
const COOLDOWN_MS = 5 * 60_000;

type QueueState = {
  queued: Set<string>;
  running: Set<string>;
  failedAt: Map<string, number>;
  changed: Array<() => void>;
};
const g = globalThis as unknown as { __farabiSuggestionQueue?: QueueState };
g.__farabiSuggestionQueue ??= { queued: new Set(), running: new Set(), failedAt: new Map(), changed: [] };
const q = g.__farabiSuggestionQueue;

async function run(messageId: string): Promise<void> {
  try {
    const message = await db
      .selectFrom("messages")
      .select(["content"])
      .where("id", "=", messageId)
      .where("role", "=", "ai")
      .where("status", "=", "complete")
      .where("replaced_at", "is", null)
      .executeTakeFirst();
    if (!message) return;
    const phrases = await getAIProvider().suggestSpans({ text: message.content });
    const spans = locateSpans(message.content, phrases);
    await db
      .insertInto("span_suggestions")
      .values({ message_id: messageId, detector_version: SPAN_DETECTOR_VERSION, spans: JSON.stringify(spans) })
      .onConflict((oc) => oc.doNothing())
      .execute();
  } catch (err) {
    // Nothing is shown for this message; it isn't asked about again until the cooldown ends.
    if (!(err instanceof AIUnavailableError)) console.error("suggestions failed", messageId, err);
    q.failedAt.set(messageId, Date.now());
  }
}

function notify(): void {
  for (const resolve of q.changed.splice(0)) resolve();
}

function pump(): void {
  for (const id of q.queued) {
    if (q.running.size >= MAX_CONCURRENT) break;
    q.queued.delete(id);
    q.running.add(id);
    void run(id).finally(() => {
      q.running.delete(id);
      notify();
      pump();
    });
  }
  if (q.queued.size === 0 && q.running.size === 0) notify();
}

export function isSuggesting(messageId: string): boolean {
  return q.queued.has(messageId) || q.running.has(messageId);
}

export function inCooldown(messageId: string): boolean {
  const at = q.failedAt.get(messageId);
  return at !== undefined && Date.now() - at < COOLDOWN_MS;
}

/** Queues analysis, in the given order; skips messages already queued, running or cooling down. */
export function enqueueSuggestions(messageIds: string[]): void {
  for (const id of messageIds) {
    if (isSuggesting(id) || inCooldown(id)) continue;
    q.queued.add(id);
  }
  queueMicrotask(pump);
}

/** Resolves once none of `messageIds` is queued or running, or after `timeoutMs`. */
export async function waitForSuggestions(messageIds: string[], timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (messageIds.some(isSuggesting)) {
    const left = deadline - Date.now();
    if (left <= 0) return;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, left);
      q.changed.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }
}

/** Resolves once no analysis is queued or running (tests). */
export async function drainSuggestions(): Promise<void> {
  while (q.queued.size > 0 || q.running.size > 0) await new Promise<void>((resolve) => q.changed.push(resolve));
}

/** Forgets failure cooldowns (tests). */
export function resetSuggestionQueue(): void {
  q.failedAt.clear();
}
