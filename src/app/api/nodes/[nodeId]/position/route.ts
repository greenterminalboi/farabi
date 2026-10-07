import { PositionRequest } from "@/shared/schemas";
import { setPosition } from "@/server/graph/positions";
import { readJson, withApi } from "@/server/http/withApi";

type Ctx = { params: Promise<{ nodeId: string }> };

/** Hand placement relative to the tree origin (FR-037). Never touches structure. */
export const PUT = withApi(async (req: Request, { params }: Ctx) => {
  const { nodeId } = await params;
  const { x, y } = await readJson(req, PositionRequest);
  return Response.json({ element: await setPosition(nodeId, x, y) });
});
