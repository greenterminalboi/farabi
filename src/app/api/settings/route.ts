import { readJson, withApi } from "@/server/http/withApi";
import { saveSettings, settingsResponse } from "@/server/settings/settings";
import { SaveSettingsBody } from "@/shared/schemas";

// Global reply settings (Feature 6, contracts/http-api.md). PUT appends changes; nothing is overwritten.
export const GET = withApi(async () => Response.json(await settingsResponse()));

export const PUT = withApi(async (req: Request) => Response.json(await saveSettings(await readJson(req, SaveSettingsBody))));
