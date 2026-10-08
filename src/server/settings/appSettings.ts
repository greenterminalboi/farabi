// The app-level settings that used to be environment variables (feature 11, data-model.md §3),
// read and changed from Settings. Each change appends a user-authored row (Article VI).
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";
import type { AppSettingsResponse, SaveAppSettingBody } from "@/shared/desktop";
import { resetClaudeCodeStatus } from "../ai/claudeCodeDiscovery";
import { InvalidRequestError } from "../errors";
import { lastExportStatus, regenerateFeedbackFile } from "../feedback/exportFile";
import { isDesktop } from "../host/bridge";
import { getAllConfig, getConfig, setConfig } from "./config";

/** 422 with its own code, for a folder that can't take the export. */
export class FolderNotWritableError extends InvalidRequestError {
  readonly reason = "folder_not_writable";
}

export function appSettingsResponse(): AppSettingsResponse {
  return { mode: isDesktop() ? "desktop" : "web", config: getAllConfig(), exportStatus: lastExportStatus() };
}

function assertWritableFolder(dir: string): void {
  if (!path.isAbsolute(dir)) throw new FolderNotWritableError("Choose a full folder path.");
  try {
    if (!statSync(dir).isDirectory()) throw new Error("not a folder");
    accessSync(dir, constants.W_OK);
  } catch {
    throw new FolderNotWritableError(`Farabi can't write to ${dir}. Choose a folder that exists and that you can write to.`);
  }
}

function assertExecutable(file: string): void {
  if (!path.isAbsolute(file)) throw new InvalidRequestError("Choose the full path to the claude program.");
  try {
    if (!statSync(file).isFile()) throw new Error("not a file");
    if (process.platform !== "win32") accessSync(file, constants.X_OK);
  } catch {
    throw new InvalidRequestError(`${file} isn't a program Farabi can run.`);
  }
}

/** Validates and appends one change. An unchanged value writes nothing. */
export async function saveAppSetting(body: SaveAppSettingBody): Promise<AppSettingsResponse> {
  const { key, value } = body;
  if (key === "feedback_export_dir" && value !== null) assertWritableFolder(value);
  if (key === "claude_code_path" && value !== null) assertExecutable(value);
  if (getConfig(key) !== value) {
    await setConfig(key, value);
    if (key === "claude_code_path" || key === "ai_provider") resetClaudeCodeStatus();
    if (key === "feedback_export_dir") {
      // The new folder gets the file right away; a failure shows in Settings, the setting stays.
      await regenerateFeedbackFile().catch((err) => console.error("Feedback export to the new folder failed", err));
    }
  }
  return appSettingsResponse();
}
