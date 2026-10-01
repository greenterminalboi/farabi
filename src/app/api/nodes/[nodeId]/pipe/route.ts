import { withApi } from "@/server/http/withApi";
import { getPipeView } from "@/server/functions/views";

type Ctx = { params: Promise<{ nodeId: string }> };

export const GET = withApi(async (_req: Request, { params }: Ctx) => {
  const { nodeId } = await params;
  return Response.json(await getPipeView(nodeId));
});
