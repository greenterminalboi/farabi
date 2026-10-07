import { BranchRequest } from "@/shared/schemas";
import { createBranch } from "@/server/graph/branch";
import { readJson, withApi } from "@/server/http/withApi";

type Ctx = { params: Promise<{ nodeId: string }> };

/** An unsent edge anchored to a span of this element's text (FR-017). The AI is never called. */
export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const { nodeId } = await params;
  const span = await readJson(req, BranchRequest);
  return Response.json(await createBranch(nodeId, span), { status: 201 });
});
