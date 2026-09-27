import { db } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { withApi } from "@/server/http/withApi";
import { assertId } from "@/server/ids";
import { enqueueSummary } from "@/server/summaries/queue";

type Ctx = { params: Promise<{ nodeId: string }> };

export const POST = withApi(async (_req: Request, { params }: Ctx) => {
  const { nodeId } = await params;
  assertId(nodeId, "Node");
  const node = await db.selectFrom("nodes").select("id").where("id", "=", nodeId).executeTakeFirst();
  if (!node) throw new NotFoundError("Node not found");
  enqueueSummary(nodeId);
  return Response.json({ queued: true }, { status: 202 });
});
