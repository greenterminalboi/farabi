import { ParkRequest } from "@/shared/schemas";
import { readJson, withApi } from "@/server/http/withApi";
import { parkTangent } from "@/server/parked/park";

type Ctx = { params: Promise<{ nodeId: string }> };

export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const { nodeId } = await params;
  const body = await readJson(req, ParkRequest);
  return Response.json(await parkTangent(nodeId, body), { status: 201 });
});
