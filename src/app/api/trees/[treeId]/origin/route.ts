import { OriginRequest } from "@/shared/schemas";
import { setTreeOrigin } from "@/server/forest/trees";
import { readJson, withApi } from "@/server/http/withApi";
import { assertId } from "@/server/ids";

type Ctx = { params: Promise<{ treeId: string }> };

export const PUT = withApi(async (req: Request, { params }: Ctx) => {
  const { treeId } = await params;
  assertId(treeId, "Tree");
  const { x, y } = await readJson(req, OriginRequest);
  return Response.json({ tree: await setTreeOrigin(treeId, x, y) });
});
