import { SendMessageRequest } from "@/shared/schemas";
import { readJson, withApi } from "@/server/http/withApi";
import { waitFor } from "@/server/messages/generation";
import { sendFromComposer } from "@/server/messages/send";

type Ctx = { params: Promise<{ nodeId: string }> };

export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const { nodeId } = await params;
  const { content } = await readJson(req, SendMessageRequest);
  const result = await sendFromComposer(nodeId, content);
  // ?wait=1 answers only once the reply has ended (tests and scripts).
  if (new URL(req.url).searchParams.get("wait") === "1") {
    result.aiMessage = await waitFor(result.aiMessage.id);
  }
  return Response.json(result, { status: 201 });
});
