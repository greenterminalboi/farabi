import { ConfirmOutputRequest } from "@/shared/schemas";
import { readJson, withApi } from "@/server/http/withApi";
import { confirmOutput } from "@/server/functions/review";

type Ctx = { params: Promise<{ nodeId: string }> };

export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const { nodeId } = await params;
  const { versionId } = await readJson(req, ConfirmOutputRequest);
  return Response.json(await confirmOutput(nodeId, versionId));
});
