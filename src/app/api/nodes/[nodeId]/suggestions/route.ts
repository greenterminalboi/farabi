import { withApi } from "@/server/http/withApi";
import { suggestionsForNode } from "@/server/suggestions/forNode";

type Ctx = { params: Promise<{ nodeId: string }> };

// POST because it may fill the hidden suggestions cache (Feature 5, contracts/http-api.md).
export const POST = withApi(async (_req: Request, { params }: Ctx) => {
  const { nodeId } = await params;
  return Response.json(await suggestionsForNode(nodeId));
});
