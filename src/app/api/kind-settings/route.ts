import { SaveKindSettingBody } from "@/shared/schemas";
import { readJson, withApi } from "@/server/http/withApi";
import { ConflictError } from "@/server/errors";
import { elementSettings, listKindSettings, setElementSetting, setKindSetting } from "@/server/settings/kindSettings";

/** Settings declared by kinds (FR-053). Saving never runs a function. */
export const GET = withApi(async () => Response.json(await listKindSettings()));

export const PUT = withApi(async (req: Request) => {
  const { kind, key, value, nodeId } = await readJson(req, SaveKindSettingBody);
  if (nodeId === undefined) return Response.json(await setKindSetting(kind, key, value));
  const target = await elementSettings(nodeId);
  if (target.kind !== kind) throw new ConflictError("wrong_kind", `This element's settings are for ${target.kind}`, { kind: target.kind });
  return Response.json(await setElementSetting(nodeId, key, value));
});
