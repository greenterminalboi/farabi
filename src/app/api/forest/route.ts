import { getForest } from "@/server/forest/forest";
import { withApi } from "@/server/http/withApi";
import { projectFromRequest } from "@/server/projects/projects";

export const dynamic = "force-dynamic";

export const GET = withApi(async (req: Request) => Response.json(await getForest(await projectFromRequest(req))));
