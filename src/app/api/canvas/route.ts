import { getCanvas } from "@/server/graph/canvas";
import { withApi } from "@/server/http/withApi";
import { assertId } from "@/server/ids";
import { projectFromRequest } from "@/server/projects/projects";

export const dynamic = "force-dynamic";

/** Every element of a project, with trees and the saved camera (research R13). */
export const GET = withApi(async (req: Request) => {
  const param = new URL(req.url).searchParams.get("projectId");
  const projectId = param ? assertId(param, "Project") : await projectFromRequest(req);
  return Response.json(await getCanvas(projectId));
});
