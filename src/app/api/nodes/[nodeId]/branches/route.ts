import { Anchor } from "@/shared/schemas";
import { createBranch } from "@/server/forest/branch";
import { readJson, withApi } from "@/server/http/withApi";

type Ctx = { params: Promise<{ nodeId: string }> };

export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const { nodeId } = await params;
  const anchor = await readJson(req, Anchor);
  return Response.json(await createBranch(nodeId, anchor), { status: 201 });
});
