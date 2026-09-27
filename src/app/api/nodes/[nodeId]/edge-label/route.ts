import { EdgeLabelRequest } from "@/shared/schemas";
import { setEdgeLabel } from "@/server/forest/edgeLabels";
import { readJson, withApi } from "@/server/http/withApi";

type Ctx = { params: Promise<{ nodeId: string }> };

export const PUT = withApi(async (req: Request, { params }: Ctx) => {
  const { nodeId } = await params;
  const { text } = await readJson(req, EdgeLabelRequest);
  return Response.json({ node: await setEdgeLabel(nodeId, text) });
});
