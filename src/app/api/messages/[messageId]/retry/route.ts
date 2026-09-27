import { withApi } from "@/server/http/withApi";
import { waitFor } from "@/server/messages/generation";
import { retryReply } from "@/server/messages/retry";

type Ctx = { params: Promise<{ messageId: string }> };

export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const { messageId } = await params;
  const result = await retryReply(messageId);
  if (new URL(req.url).searchParams.get("wait") === "1") result.aiMessage = await waitFor(result.aiMessage.id);
  return Response.json(result, { status: 201 });
});
