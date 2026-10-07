import { AttemptRequest } from "@/shared/schemas";
import { newAttempt } from "@/server/graph/attempts";
import { readJson, withApi } from "@/server/http/withApi";
import { maybeWait } from "@/server/http/wait";

type Ctx = { params: Promise<{ edgeId: string }> };

/** Retry or regenerate: a new sibling answer under this edge (FR-041, FR-042). */
export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const { edgeId } = await params;
  const { mode } = await readJson(req, AttemptRequest);
  return Response.json(await maybeWait(req, await newAttempt(edgeId, mode)), { status: 201 });
});
