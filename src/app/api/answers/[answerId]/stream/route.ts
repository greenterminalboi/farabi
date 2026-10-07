import { finalizeOrphan, subscribe, type GenerationEvent } from "@/server/answers/generation";
import { db } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { toElement } from "@/server/graph/elements";
import { withApi } from "@/server/http/withApi";
import { assertId } from "@/server/ids";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ answerId: string }> };

const encoder = new TextEncoder();
const frame = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

/**
 * Server-Sent Events for one answer: `snapshot` (text so far), `delta`s, then `end` with the final
 * answer. Closing the connection never stops the generation (FR-012).
 */
export const GET = withApi(async (req: Request, { params }: Ctx) => {
  const { answerId } = await params;
  assertId(answerId, "Answer");
  const row = await db.selectFrom("nodes").selectAll().where("id", "=", answerId).where("kind", "=", "answer").executeTakeFirst();
  if (!row) throw new NotFoundError("Answer not found");

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };
      const listener = (event: GenerationEvent) => {
        if (closed) return;
        if (event.type === "delta") controller.enqueue(frame("delta", { text: event.text }));
        else {
          controller.enqueue(frame("end", { answer: event.answer }));
          sub?.unsubscribe();
          close();
        }
      };
      const sub = subscribe(answerId, listener);
      req.signal.addEventListener("abort", () => {
        sub?.unsubscribe();
        close();
      });
      if (sub) {
        controller.enqueue(frame("snapshot", { text: sub.snapshot }));
        return;
      }
      // Not generating: already ended, or orphaned by a restart.
      const final = toElement(await finalizeOrphan(row));
      controller.enqueue(frame("snapshot", { text: final.text ?? "" }));
      controller.enqueue(frame("end", { answer: final }));
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
});
