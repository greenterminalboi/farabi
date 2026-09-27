import { withApi } from "@/server/http/withApi";
import { retryReply } from "@/server/messages/retry";

type Ctx = { params: Promise<{ messageId: string }> };

export const POST = withApi(async (_req: Request, { params }: Ctx) => {
  const { messageId } = await params;
  return Response.json(await retryReply(messageId), { status: 201 });
});
