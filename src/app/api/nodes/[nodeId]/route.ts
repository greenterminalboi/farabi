import { getNodeView } from "@/server/forest/nodeView";
import { withApi } from "@/server/http/withApi";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ nodeId: string }> };

export const GET = withApi(async (_req: Request, { params }: Ctx) => {
  const { nodeId } = await params;
  return Response.json(await getNodeView(nodeId));
});
