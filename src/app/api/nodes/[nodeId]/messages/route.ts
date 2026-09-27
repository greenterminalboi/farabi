import { SendMessageRequest } from "@/shared/schemas";
import { readJson, withApi } from "@/server/http/withApi";
import { sendMessage } from "@/server/messages/send";

type Ctx = { params: Promise<{ nodeId: string }> };

export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const { nodeId } = await params;
  const { content } = await readJson(req, SendMessageRequest);
  return Response.json(await sendMessage(nodeId, content), { status: 201 });
});
