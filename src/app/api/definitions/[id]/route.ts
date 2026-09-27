import { getDefinition } from "@/server/definitions/list";
import { withApi } from "@/server/http/withApi";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withApi(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return Response.json(await getDefinition(id));
});
