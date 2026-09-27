import { confirmDefinition } from "@/server/definitions/versions";
import { withApi } from "@/server/http/withApi";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withApi(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return Response.json({ definition: await confirmDefinition(id) }, { status: 201 });
});
