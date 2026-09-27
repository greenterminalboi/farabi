import { getForest } from "@/server/forest/forest";
import { withApi } from "@/server/http/withApi";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => Response.json(await getForest()));
