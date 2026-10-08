import { providerReady } from "@/server/ai";
import { StartTreeRequest } from "@/shared/schemas";
import { startTree } from "@/server/graph/ask";
import { readJson, withApi } from "@/server/http/withApi";
import { maybeWait } from "@/server/http/wait";

/** Starts a tree: an origin edge and its pending answer (FR-005). The reply starts after commit. */
export const POST = withApi(async (req: Request) => {
  await providerReady();
  const { projectId, content } = await readJson(req, StartTreeRequest);
  return Response.json(await maybeWait(req, await startTree(projectId, content)), { status: 201 });
});
