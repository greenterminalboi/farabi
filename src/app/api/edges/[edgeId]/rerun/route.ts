import { providerReady } from "@/server/ai";
import { rerunFunction } from "@/server/functions/runner";
import { withApi } from "@/server/http/withApi";

type Ctx = { params: Promise<{ edgeId: string }> };

/** Another output under an existing function edge, using its override (FR-051, FR-053). */
export const POST = withApi(async (_req: Request, { params }: Ctx) => {
  await providerReady();
  const { edgeId } = await params;
  return Response.json(await rerunFunction(edgeId), { status: 201 });
});
