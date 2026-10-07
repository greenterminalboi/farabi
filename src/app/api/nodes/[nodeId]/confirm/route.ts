import { confirmOutput } from "@/server/functions/review";
import { withApi } from "@/server/http/withApi";

type Ctx = { params: Promise<{ nodeId: string }> };

/** Appends a `confirmed` review to a function output (FR-050). */
export const POST = withApi(async (_req: Request, { params }: Ctx) => {
  const { nodeId } = await params;
  return Response.json(await confirmOutput(nodeId));
});
