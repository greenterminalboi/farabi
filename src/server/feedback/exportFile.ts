import { promises as fs } from "node:fs";
import path from "node:path";
import { sql } from "kysely";
import type { FeedbackItem, FeedbackState } from "@/shared/schemas";
import { db as defaultDb, type DB } from "../db/client";
import { listFeedback } from "./list";
import { exportDir, exportDirChosen, feedbackDir, REPO_ROOT, repoRelative } from "./paths";

// The file Claude Code reads (contracts/feedback-file.md). Generated in full from the database;
// never edited by hand.

const SECTIONS: Array<{ state: FeedbackState; title: string; intro: string | null }> = [
  { state: "open", title: "Open", intro: "Listed in the user's panel order (the most important are usually first)." },
  {
    state: "addressed",
    title: "Addressed",
    intro: "Claude Code marked these done. They wait for the user to confirm or reopen them.",
  },
  { state: "resolved", title: "Resolved", intro: null },
];

function renderItem(item: FeedbackItem): string {
  const since = item.history.at(-1)?.at ?? item.createdAt;
  const { view, projectId, elementId, element, nodeId } = item.context;
  const context = [`view: ${view}`];
  if (projectId) context.push(`project: ${projectId}`);
  // The element's kind and the start of its text (FR-058); the v1 conversation on older items.
  if (elementId) {
    context.push(`element: ${elementId}${element ? ` (${element.kind}: ${JSON.stringify(element.excerpt)})` : ""}`);
  } else if (nodeId) context.push(`node: ${nodeId}`);
  const lines = [
    `### ${item.id}`,
    "",
    `- State: ${item.state} (since ${since})`,
    `- Captured: ${item.createdAt} · ${context.join(" · ")}`,
    `- Tags: ${item.tags.length ? item.tags.map((t) => t.text).join(", ") : "none"}`,
  ];
  if (item.attachments.length) {
    lines.push("- Attachments:");
    for (const a of item.attachments) lines.push(`  - ${a.path}`);
  } else {
    lines.push("- Attachments: none");
  }
  lines.push("- History:");
  for (const e of item.history) lines.push(`  - ${e.at} ${e.state} (${e.provenance})`);
  lines.push("");
  // Blockquoting every line keeps Markdown in the text from creating headings in this file.
  for (const line of item.text.split(/\r?\n/)) lines.push(line ? `> ${line}` : ">");
  return lines.join("\n");
}

/** Pure rendering; `items` are in panel order. */
export function renderFeedbackFile(items: FeedbackItem[], now: Date): string {
  const count = (s: FeedbackState) => items.filter((i) => i.state === s).length;
  const out = [
    "# Farabi feedback",
    "",
    "<!-- Generated from the database. Do not edit; changes here are overwritten. -->",
    "",
    `Generated ${now.toISOString()} · ${count("open")} open · ${count("addressed")} addressed · ${count("resolved")} resolved`,
    "",
    "To mark an item addressed after you have done the work:",
    "",
    "    npm run feedback:addressed -- <item id>",
    "",
    "Only the user can mark an item resolved. Attachment paths are relative to the repo root.",
  ];
  for (const section of SECTIONS) {
    let inSection = items.filter((i) => i.state === section.state);
    if (section.state !== "open") {
      const latest = (i: FeedbackItem) => i.history.at(-1)?.at ?? i.createdAt;
      inSection = [...inSection].sort((a, b) => (latest(a) < latest(b) ? 1 : latest(a) > latest(b) ? -1 : 0));
    }
    out.push("", `## ${section.title}`, "");
    if (section.intro) out.push(section.intro, "");
    if (inSection.length === 0) out.push("_None._");
    else out.push(inSection.map((i) => renderItem(i)).join("\n\n"));
  }
  return `${out.join("\n")}\n`;
}

export type ExportStatus = { ok: boolean; at: string; dir: string | null; error: string | null };
const g = globalThis as unknown as { __farabiExportStatus?: ExportStatus };

/** The outcome of the last export, shown in Settings (feature 11, T066). */
export function lastExportStatus(): ExportStatus | null {
  return g.__farabiExportStatus ?? null;
}

/**
 * Copies the attachments FEEDBACK.md lists into `<export>/attachments/`, only those missing or
 * changed. Nothing to do when attachments are stored in the export folder itself (the web app).
 */
async function mirrorAttachments(items: FeedbackItem[], out: string): Promise<FeedbackItem[]> {
  const store = feedbackDir();
  if (path.resolve(out) === path.resolve(store)) return items;
  const mirrored: FeedbackItem[] = [];
  for (const item of items) {
    const attachments = [];
    for (const a of item.attachments) {
      const source = path.resolve(REPO_ROOT, a.path);
      const rel = path.relative(store, source);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        attachments.push(a);
        continue;
      }
      const dest = path.join(out, rel);
      const [from, to] = await Promise.all([fs.stat(source).catch(() => null), fs.stat(dest).catch(() => null)]);
      if (from && (!to || to.size !== from.size || to.mtimeMs < from.mtimeMs)) {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(source, dest);
      }
      attachments.push({ ...a, path: repoRelative(dest) });
    }
    mirrored.push({ ...item, attachments });
  }
  return mirrored;
}

/**
 * Rewrites FEEDBACK.md from the database (research R6): under an advisory lock so the app and the
 * script never interleave, via a temp file and rename so a reader never sees half a file and a
 * failed write leaves the previous one in place. Returns the file written, or null when export is
 * off (the desktop app with no folder chosen).
 */
export async function regenerateFeedbackFile(db: DB = defaultDb): Promise<string | null> {
  const out = exportDir();
  if (!out) {
    g.__farabiExportStatus = { ok: true, at: new Date().toISOString(), dir: null, error: null };
    return null;
  }
  const target = path.join(out, "FEEDBACK.md");
  try {
    await db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext('farabi_feedback_file'))`.execute(trx);
      // A chosen folder must exist (it may be on a drive that's gone); the default one is created.
      if (exportDirChosen()) {
        const stat = await fs.stat(out).catch(() => null);
        if (!stat?.isDirectory()) throw new Error(`The feedback export folder ${out} doesn't exist.`);
      } else {
        await fs.mkdir(out, { recursive: true });
      }
      const items = await mirrorAttachments(await listFeedback(trx), out);
      const text = renderFeedbackFile(items, new Date());
      const tmp = `${target}.tmp`;
      await fs.writeFile(tmp, text);
      await fs.rename(tmp, target);
    });
  } catch (err) {
    g.__farabiExportStatus = { ok: false, at: new Date().toISOString(), dir: out, error: err instanceof Error ? err.message : String(err) };
    throw err;
  }
  g.__farabiExportStatus = { ok: true, at: new Date().toISOString(), dir: out, error: null };
  return target;
}

/** Regenerates after a committed write; a failure is logged, never surfaced (the DB is canonical). */
export async function afterFeedbackWrite(db: DB = defaultDb): Promise<void> {
  try {
    await regenerateFeedbackFile(db);
  } catch (err) {
    console.error("Could not regenerate FEEDBACK.md; the previous file is unchanged.", err);
  }
}
