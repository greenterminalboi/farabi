import { withApi } from "@/server/http/withApi";
import { openProject, projectCookie } from "@/server/projects/projects";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withApi(async (_req: Request, { params }: Ctx) => {
  const project = await openProject((await params).id);
  return Response.json({ project }, { headers: { "set-cookie": projectCookie(project.id) } });
});
