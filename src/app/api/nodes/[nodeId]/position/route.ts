import { PositionRequest } from "@/shared/schemas";
import { setNodePosition } from "@/server/forest/positions";
import { readJson, withApi } from "@/server/http/withApi";

type Ctx = { params: Promise<{ nodeId: string }> };

export const PUT = withApi(async (req: Request, { params }: Ctx) => {
  const { nodeId } = await params;
  const { x, y } = await readJson(req, PositionRequest);
  return Response.json({ node: await setNodePosition(nodeId, x, y) });
});
