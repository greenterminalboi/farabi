import { withApi } from "@/server/http/withApi";
import { projectCookie, projectFromRequest, trashProject } from "@/server/projects/projects";

type Ctx = { params: Promise<{ id: string }> };

/** Moves a project to the trash (hidden, never deleted); may change the open project (FR-009). */
export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const currentId = await trashProject((await params).id, await projectFromRequest(req));
  return Response.json({ currentId }, { headers: { "set-cookie": projectCookie(currentId) } });
});
