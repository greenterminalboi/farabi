import { SaveEdgeSettingBody } from "@/shared/schemas";
import { readJson, withApi } from "@/server/http/withApi";
import { edgeSettings, setEdgeSetting } from "@/server/settings/kindSettings";

type Ctx = { params: Promise<{ edgeId: string }> };

/** The override on a function edge; null clears it. Never starts a run (FR-053). */
export const PUT = withApi(async (req: Request, { params }: Ctx) => {
  const { edgeId } = await params;
  const { key, value } = await readJson(req, SaveEdgeSettingBody);
  return Response.json(await setEdgeSetting(edgeId, key, value));
});

export const dynamic = "force-dynamic";

/** The edge's settings as they resolve: its override, then the kind value, then the default. */
export const GET = withApi(async (_req: Request, { params }: Ctx) => {
  const { edgeId } = await params;
  return Response.json(await edgeSettings(edgeId));
});
