import { withApi } from "@/server/http/withApi";
import { regenerateReply } from "@/server/messages/regenerate";

type Ctx = { params: Promise<{ messageId: string }> };

export const POST = withApi(async (_req: Request, { params }: Ctx) => {
  const { messageId } = await params;
  return Response.json(await regenerateReply(messageId), { status: 201 });
});
