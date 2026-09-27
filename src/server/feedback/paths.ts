import path from "node:path";

/**
 * The repository root. The app, the npm scripts and the tests all run from it; `import.meta`
 * paths are not reliable once Next.js bundles server code.
 */
export const REPO_ROOT = process.cwd();

/** Where FEEDBACK.md and attachments live (research R6). Relative values resolve from the repo root. */
export function feedbackDir(): string {
  // Runtime data, not part of the build: keep Turbopack from tracing the whole project.
  return path.resolve(/*turbopackIgnore: true*/ REPO_ROOT, process.env.FEEDBACK_DIR || "feedback");
}

export function feedbackFilePath(): string {
  return path.join(feedbackDir(), "FEEDBACK.md");
}

/** Absolute path for a stored attachment path (stored relative to the feedback folder). */
export function attachmentAbsPath(relative: string): string {
  return path.join(/*turbopackIgnore: true*/ feedbackDir(), relative);
}

/** A path as Claude Code should see it: relative to the repo root when inside it. */
export function repoRelative(absolute: string): string {
  const rel = path.relative(REPO_ROOT, absolute);
  return rel.startsWith("..") || path.isAbsolute(rel) ? absolute : rel.split(path.sep).join("/");
}
