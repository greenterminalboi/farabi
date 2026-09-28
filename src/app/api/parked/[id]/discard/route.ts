import { withApi } from "@/server/http/withApi";
import { discardParked } from "@/server/parked/park";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withApi(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return Response.json(await discardParked(id));
});
