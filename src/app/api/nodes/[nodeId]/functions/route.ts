import { withApi } from "@/server/http/withApi";
import { listAvailableFunctions } from "@/server/functions/runner";

type Ctx = { params: Promise<{ nodeId: string }> };

export const GET = withApi(async (_req: Request, { params }: Ctx) => {
  const { nodeId } = await params;
  return Response.json(await listAvailableFunctions(nodeId));
});
