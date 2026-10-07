import { SaveKindSettingBody } from "@/shared/schemas";
import { readJson, withApi } from "@/server/http/withApi";
import { listKindSettings, setKindSetting } from "@/server/settings/kindSettings";

/** Settings declared by kinds (FR-053). Saving never runs a function. */
export const GET = withApi(async () => Response.json(await listKindSettings()));

export const PUT = withApi(async (req: Request) => {
  const { kind, key, value } = await readJson(req, SaveKindSettingBody);
  return Response.json(await setKindSetting(kind, key, value));
});
