import { stopGeneration } from "@/server/answers/generation";
import { ConflictError } from "@/server/errors";
import { withApi } from "@/server/http/withApi";
import { assertId } from "@/server/ids";

type Ctx = { params: Promise<{ answerId: string }> };

/** Stops a streaming reply; its text so far is kept, marked stopped (FR-011). */
export const POST = withApi(async (_req: Request, { params }: Ctx) => {
  const { answerId } = await params;
  assertId(answerId, "Answer");
  const answer = await stopGeneration(answerId);
  if (!answer) throw new ConflictError("not_streaming", "This reply isn't streaming");
  return Response.json({ answer });
});
