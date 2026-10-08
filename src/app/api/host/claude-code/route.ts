import { claudeCodeStatus } from "@/server/ai/claudeCodeDiscovery";
import { withApi } from "@/server/http/withApi";

export const dynamic = "force-dynamic";

/** Where Claude Code is and whether it runs (research R8). Cached 60 s; `?refresh=1` rechecks. */
export const GET = withApi(async (req: Request) =>
  Response.json(await claudeCodeStatus({ refresh: new URL(req.url).searchParams.get("refresh") === "1" })),
);
