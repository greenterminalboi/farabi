import { readJson, withApi } from "@/server/http/withApi";
import { appSettingsResponse, saveAppSetting } from "@/server/settings/appSettings";
import { SaveAppSettingBody } from "@/shared/desktop";

// App settings that used to be environment variables (feature 11, contracts/http-additions.md).
// PUT appends a change; nothing is overwritten.
export const GET = withApi(async () => Response.json(appSettingsResponse()));

export const PUT = withApi(async (req: Request) => Response.json(await saveAppSetting(await readJson(req, SaveAppSettingBody))));
