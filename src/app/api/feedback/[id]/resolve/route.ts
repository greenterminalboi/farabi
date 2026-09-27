import { resolveFeedback } from "@/server/feedback/state";
import { withApi } from "@/server/http/withApi";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withApi(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return Response.json({ item: await resolveFeedback(id) });
});
