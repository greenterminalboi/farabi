import { Camera } from "@/shared/schemas";
import { saveCamera } from "@/server/graph/positions";
import { readJson, withApi } from "@/server/http/withApi";

type Ctx = { params: Promise<{ id: string }> };

/** Saves the project's camera once it has been idle for 500 ms (FR-028). */
export const PUT = withApi(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const camera = await readJson(req, Camera);
  return Response.json({ camera: await saveCamera(id, camera) });
});
