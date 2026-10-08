import { StartTreeRequest } from "@/shared/schemas";
import { startTree } from "@/server/graph/ask";
import { readJson, withApi } from "@/server/http/withApi";
import { maybeWait } from "@/server/http/wait";

/** Starts a tree: an origin edge and its pending answer (FR-005). The reply starts after commit. */
export const POST = withApi(async (req: Request) => {
  const { projectId, content, terms } = await readJson(req, StartTreeRequest);
  return Response.json(await maybeWait(req, await startTree(projectId, content, terms)), { status: 201 });
});
