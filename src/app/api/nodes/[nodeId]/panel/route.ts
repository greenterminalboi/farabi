import { getPanel } from "@/server/graph/panel";
import { withApi } from "@/server/http/withApi";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ nodeId: string }> };

/** Direct child edges, newest first, and live parked tangents (FR-022). */
export const GET = withApi(async (_req: Request, { params }: Ctx) => {
  const { nodeId } = await params;
  return Response.json(await getPanel(nodeId));
});
