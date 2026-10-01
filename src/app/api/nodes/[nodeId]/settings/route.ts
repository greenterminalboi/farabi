import { SaveNodeSettingBody } from "@/shared/schemas";
import { readJson, withApi } from "@/server/http/withApi";
import { setNodeSetting } from "@/server/settings/kindSettings";

type Ctx = { params: Promise<{ nodeId: string }> };

/** One node's override of a setting its kind declares (Feature 9, FR-031, FR-033). */
export const PUT = withApi(async (req: Request, { params }: Ctx) => {
  const { nodeId } = await params;
  const { key, value } = await readJson(req, SaveNodeSettingBody);
  return Response.json({ settings: await setNodeSetting(nodeId, key, value) });
});
