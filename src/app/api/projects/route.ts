import { readJson, withApi } from "@/server/http/withApi";
import { createProject, listProjects, projectCookie, projectFromRequest } from "@/server/projects/projects";
import { CreateProjectRequest } from "@/shared/schemas";

export const dynamic = "force-dynamic";

export const GET = withApi(async (req: Request) => Response.json(await listProjects(await projectFromRequest(req))));

/** Creates a project and makes it the open one (FR-003). */
export const POST = withApi(async (req: Request) => {
  const { name } = await readJson(req, CreateProjectRequest);
  const project = await createProject(name);
  return Response.json({ project }, { status: 201, headers: { "set-cookie": projectCookie(project.id) } });
});
