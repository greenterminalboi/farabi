import { createRootTree } from "@/server/forest/trees";
import { withApi } from "@/server/http/withApi";
import { projectFromRequest } from "@/server/projects/projects";

export const POST = withApi(async (req: Request) =>
  Response.json(await createRootTree(await projectFromRequest(req)), { status: 201 }),
);
