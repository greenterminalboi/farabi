import path from "node:path";
import { isDesktop } from "../host/bridge";
import { getConfig, resolveConfig } from "../settings/config";

/**
 * The repository root. The app, the npm scripts and the tests all run from it; `import.meta`
 * paths are not reliable once Next.js bundles server code.
 */
export const REPO_ROOT = process.cwd();

/**
 * Where attachments are stored (research R6, feature 11 T066): `<data dir>/feedback/` in the
 * desktop app, else FEEDBACK_DIR (or the repo's feedback/). Relative values resolve from the repo root.
 */
export function feedbackDir(): string {
  if (isDesktop() && process.env.FARABI_DATA_DIR) return path.join(process.env.FARABI_DATA_DIR, "feedback");
  // Runtime data, not part of the build: keep Turbopack from tracing the whole project.
  return path.resolve(/*turbopackIgnore: true*/ REPO_ROOT, process.env.FEEDBACK_DIR || "feedback");
}

/**
 * Where FEEDBACK.md and the attachment mirror are written, or null when export is off (the desktop
 * app until a folder is chosen). In the web app this is FEEDBACK_DIR or feedback/, as before.
 */
export function exportDir(): string | null {
  const dir = getConfig("feedback_export_dir");
  return dir ? path.resolve(/*turbopackIgnore: true*/ REPO_ROOT, dir) : null;
}

/** True when the user chose the export folder (so it must already exist), not a default. */
export function exportDirChosen(): boolean {
  return resolveConfig("feedback_export_dir").source === "row";
}

export function feedbackFilePath(): string {
  return path.join(exportDir() ?? feedbackDir(), "FEEDBACK.md");
}

/** Absolute path for a stored attachment path (stored relative to the feedback folder). */
export function attachmentAbsPath(relative: string): string {
  const root = feedbackDir();
  const abs = path.resolve(/*turbopackIgnore: true*/ root, relative);
  // Stored paths are always attachments/<item>/<file>; anything escaping the folder is refused.
  if (path.isAbsolute(relative) || !abs.startsWith(root + path.sep)) {
    throw new Error(`Attachment path outside the feedback folder: ${relative}`);
  }
  return abs;
}

/** A path as Claude Code should see it: relative to the repo root when inside it. */
export function repoRelative(absolute: string): string {
  const rel = path.relative(REPO_ROOT, absolute);
  return rel.startsWith("..") || path.isAbsolute(rel) ? absolute : rel.split(path.sep).join("/");
}
