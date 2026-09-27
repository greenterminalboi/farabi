import { withApi } from "@/server/http/withApi";
import { restoreProject } from "@/server/projects/projects";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withApi(async (_req: Request, { params }: Ctx) =>
  Response.json({ project: await restoreProject((await params).id) }),
);
