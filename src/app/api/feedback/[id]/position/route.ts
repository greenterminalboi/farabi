import { moveFeedback } from "@/server/feedback/position";
import { readJson, withApi } from "@/server/http/withApi";
import { FeedbackPositionRequest } from "@/shared/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = withApi(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { aboveId, belowId } = await readJson(req, FeedbackPositionRequest);
  return Response.json({ item: await moveFeedback(id, aboveId, belowId) });
});
