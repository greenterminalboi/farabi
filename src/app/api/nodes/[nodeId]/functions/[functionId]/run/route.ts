import { withApi } from "@/server/http/withApi";
import { runFunction } from "@/server/functions/runner";

type Ctx = { params: Promise<{ nodeId: string; functionId: string }> };

export const POST = withApi(async (_req: Request, { params }: Ctx) => {
  const { nodeId, functionId } = await params;
  return Response.json(await runFunction(functionId, nodeId), { status: 201 });
});
