import { withApi } from "@/server/http/withApi";
import { assertId } from "@/server/ids";
import { assertConversationNode } from "@/server/nodes/kinds";
import { enqueueSummary } from "@/server/summaries/queue";

type Ctx = { params: Promise<{ nodeId: string }> };

export const POST = withApi(async (_req: Request, { params }: Ctx) => {
  const { nodeId } = await params;
  assertId(nodeId, "Node");
  await assertConversationNode(nodeId);
  enqueueSummary(nodeId);
  return Response.json({ queued: true }, { status: 202 });
});
