import { AskRequest } from "@/shared/schemas";
import { ask } from "@/server/graph/ask";
import { readJson, withApi } from "@/server/http/withApi";
import { maybeWait } from "@/server/http/wait";

type Ctx = { params: Promise<{ nodeId: string }> };

/** A new question edge from this element and a pending answer; "????" may quick-branch (FR-020). */
export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const { nodeId } = await params;
  const { content } = await readJson(req, AskRequest);
  return Response.json(await maybeWait(req, await ask(nodeId, content)), { status: 201 });
});
