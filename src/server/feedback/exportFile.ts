import { promises as fs } from "node:fs";
import path from "node:path";
import { sql } from "kysely";
import type { FeedbackItem, FeedbackState } from "@/shared/schemas";
import { db as defaultDb, type DB } from "../db/client";
import { placeholderFor } from "../summaries/placeholder";
import { listFeedback } from "./list";
import { feedbackFilePath } from "./paths";

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

function renderItem(item: FeedbackItem, nodeLabels: Map<string, string>): string {
  const since = item.history.at(-1)?.at ?? item.createdAt;
  const node = item.context.nodeId;
  const label = node ? nodeLabels.get(node) : undefined;
  const context = [`view: ${item.context.view}`];
  if (node) context.push(`node: ${node}${label ? ` (${JSON.stringify(label)})` : ""}`);
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
export function renderFeedbackFile(items: FeedbackItem[], nodeLabels: Map<string, string>, now: Date): string {
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
    else out.push(inSection.map((i) => renderItem(i, nodeLabels)).join("\n\n"));
  }
  return `${out.join("\n")}\n`;
}

/** Current map label for each node an item points at: latest summary, else the placeholder. */
async function nodeLabels(db: DB, items: FeedbackItem[]): Promise<Map<string, string>> {
  const ids = [...new Set(items.map((i) => i.context.nodeId).filter((id): id is string => id !== null))];
  const labels = new Map<string, string>();
  if (ids.length === 0) return labels;
  const [summaries, markers] = await Promise.all([
    db
      .selectFrom("node_summaries")
      .select(["node_id", "text"])
      .distinctOn("node_id")
      .where("node_id", "in", ids)
      .orderBy("node_id")
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .execute(),
    db.selectFrom("branch_markers").select(["child_node_id", "anchor_text"]).where("child_node_id", "in", ids).execute(),
  ]);
  const anchors = new Map(markers.map((m) => [m.child_node_id, m.anchor_text]));
  for (const id of ids) labels.set(id, placeholderFor(anchors.get(id) ?? null).text);
  for (const s of summaries) labels.set(s.node_id, s.text);
  return labels;
}

/**
 * Rewrites FEEDBACK.md from the database (research R6): under an advisory lock so the app and the
 * script never interleave, via a temp file and rename so a reader never sees half a file and a
 * failed write leaves the previous one in place.
 */
export async function regenerateFeedbackFile(db: DB = defaultDb): Promise<string> {
  const target = feedbackFilePath();
  await db.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtext('farabi_feedback_file'))`.execute(trx);
    const items = await listFeedback(trx);
    const text = renderFeedbackFile(items, await nodeLabels(trx, items), new Date());
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, text);
    await fs.rename(tmp, target);
  });
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
