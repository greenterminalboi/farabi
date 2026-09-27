import { ConflictError } from "@/server/errors";
import { withApi } from "@/server/http/withApi";
import { assertId } from "@/server/ids";
import { stopGeneration } from "@/server/messages/generation";

type Ctx = { params: Promise<{ messageId: string }> };

/** Stops a streaming reply; its text so far is kept, marked stopped (FR-003a). */
export const POST = withApi(async (_req: Request, { params }: Ctx) => {
  const { messageId } = await params;
  assertId(messageId, "Message");
  const message = await stopGeneration(messageId);
  if (!message) throw new ConflictError("not_streaming", "This reply isn't streaming");
  return Response.json({ message });
});
