import { withApi } from "@/server/http/withApi";
import { regenerateOutput } from "@/server/functions/runner";

type Ctx = { params: Promise<{ nodeId: string }> };

export const POST = withApi(async (_req: Request, { params }: Ctx) => {
  const { nodeId } = await params;
  return Response.json(await regenerateOutput(nodeId), { status: 201 });
});
