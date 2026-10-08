// Client calls for the desktop app's own routes (feature 11, contracts/http-additions.md). Kept
// apart from api.ts so other lanes' edits there don't collide.
import { z, type ZodType } from "zod";
import {
  ApiKeyStatus,
  AppSettingsResponse,
  ClaudeCodeStatus,
  HostInfo,
  ImportCheckResponse,
  ImportResult,
  PickFolderResponse,
  type SaveAppSettingBody,
  SnapshotsResponse,
} from "@/shared/desktop";
import { ApiError } from "./api";

const Empty = z.unknown();

async function request<T>(method: string, path: string, schema: ZodType<T>, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const json: unknown = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new ApiError(res.status, err?.code ?? "http_error", err?.message ?? `HTTP ${res.status}`, json);
  }
  return schema.parse(json);
}

export const desktopApi = {
  appSettings: () => request("GET", "/api/settings/app", AppSettingsResponse),
  saveAppSetting: (body: SaveAppSettingBody) => request("PUT", "/api/settings/app", AppSettingsResponse, body),
  hostInfo: () => request("GET", "/api/host/info", HostInfo),
  reveal: (target: "data" | "logs" | "export") => request("POST", "/api/host/reveal", Empty, { target }),
  pick: (purpose: "feedback_export" | "import_attachments" | "claude_code") =>
    request("POST", "/api/host/pick-folder", PickFolderResponse, { purpose }),
  apiKey: () => request("GET", "/api/host/api-key", ApiKeyStatus),
  saveApiKey: (value: string) => request("PUT", "/api/host/api-key?verify=1", Empty, { value }),
  removeApiKey: () => request("PUT", "/api/host/api-key", Empty, { value: null }),
  claudeCode: (refresh = false) => request("GET", `/api/host/claude-code${refresh ? "?refresh=1" : ""}`, ClaudeCodeStatus),
  snapshots: () => request("GET", "/api/host/snapshots", SnapshotsResponse),
  restoreSnapshot: (name: string) => request("POST", "/api/host/snapshots", Empty, { name }),
  checkImport: (connectionString: string, attachmentsDir?: string) =>
    request("POST", "/api/host/import/check", ImportCheckResponse, { connectionString, ...(attachmentsDir ? { attachmentsDir } : {}) }),
  runImport: (connectionString: string, attachmentsDir?: string) =>
    request("POST", "/api/host/import", ImportResult, { connectionString, ...(attachmentsDir ? { attachmentsDir } : {}) }),
};
