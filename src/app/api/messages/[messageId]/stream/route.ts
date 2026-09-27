import { db } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { withApi } from "@/server/http/withApi";
import { assertId } from "@/server/ids";
import { toMessage } from "@/server/mappers";
import { finalizeOrphan, subscribe, type GenerationEvent } from "@/server/messages/generation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ messageId: string }> };

const encoder = new TextEncoder();
const frame = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

/**
 * Server-Sent Events for one reply: `snapshot` (text so far), `delta`s, then `end` with the final
 * message. Closing the connection never stops the generation (FR-004).
 */
export const GET = withApi(async (req: Request, { params }: Ctx) => {
  const { messageId } = await params;
  assertId(messageId, "Message");
  const row = await db.selectFrom("messages").selectAll().where("id", "=", messageId).executeTakeFirst();
  if (!row) throw new NotFoundError("Message not found");

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
          controller.enqueue(frame("end", { message: event.message }));
          sub?.unsubscribe();
          close();
        }
      };
      const sub = subscribe(messageId, listener);
      req.signal.addEventListener("abort", () => {
        sub?.unsubscribe();
        close();
      });
      if (sub) {
        controller.enqueue(frame("snapshot", { text: sub.snapshot }));
        return;
      }
      // Not generating: already ended, or orphaned by a restart.
      const final = toMessage(await finalizeOrphan(row));
      controller.enqueue(frame("snapshot", { text: final.content }));
      controller.enqueue(frame("end", { message: final }));
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
