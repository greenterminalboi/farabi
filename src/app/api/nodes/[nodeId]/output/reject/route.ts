import { withApi } from "@/server/http/withApi";
import { rejectOutput } from "@/server/functions/review";

type Ctx = { params: Promise<{ nodeId: string }> };

export const POST = withApi(async (_req: Request, { params }: Ctx) => {
  const { nodeId } = await params;
  return Response.json(await rejectOutput(nodeId));
});
