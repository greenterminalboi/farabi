// The five invariants of contracts/migration.md ("Invariants checked by v1:verify"): the converted
// graph says what v1 said, gives every reply the same context, loses nothing, and leaves the
// originals byte-identical. Run by `npm run v1:verify` and the conversion test.
import { type Kysely, sql } from "kysely";
import type { ChatTurn } from "../../ai/provider";
import { buildReplyInput } from "../../graph/context";
import { V1_TABLES } from "../migrations/0010_message_graph";
import { convertV1 } from "./convert";

export type Check = { name: string; ok: boolean; details: string[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- reads the v1 schema, outside the app's Database type
type Q = Kysely<any>;

type Msg = { id: string; node_id: string; seq: number; role: "user" | "ai"; content: string; status: string; replaced_at: Date | null; created_at: Date };
type Marker = { child_node_id: string; parent_node_id: string; message_id: string; kind: "selection" | "whole_message" };
type El = { id: string; parent_id: string | null; kind: string; text: string | null; status: string | null; created_at: Date };

const MAX_DETAILS = 20;

async function load(db: Q) {
  const [messages, markers, conversations, elements] = await Promise.all([
    sql<Msg>`SELECT id, node_id, seq, role, content, status, replaced_at, created_at FROM v1.messages`.execute(db),
    sql<Marker>`SELECT child_node_id, parent_node_id, message_id, kind FROM v1.branch_markers`.execute(db),
    sql<{ id: string; parent_id: string | null }>`SELECT id, parent_id FROM v1.nodes WHERE kind = 'conversation'`.execute(db),
    sql<El>`SELECT id, parent_id, kind, text, status, created_at FROM nodes`.execute(db),
  ]);
  const live = new Map<string, Msg[]>();
  for (const m of messages.rows) {
    if (m.replaced_at !== null) continue;
    live.set(m.node_id, [...(live.get(m.node_id) ?? []), m]);
  }
  for (const list of live.values()) list.sort((a, b) => a.seq - b.seq);
  return {
    messages: messages.rows,
    live,
    markers: new Map(markers.rows.map((m) => [m.child_node_id, m])),
    conversations: conversations.rows,
    elements: new Map(elements.rows.map((e) => [e.id, e])),
  };
}

/** 1. Every live v1 message is a v2 element with the same role, text and time, on the right path. */
export async function textReproduction(db: Q): Promise<Check> {
  const { live, elements } = await load(db);
  const details: string[] = [];
  for (const [conv, msgs] of live) {
    let lastUser: Msg | null = null;
    let newestComplete: Msg | null = null;
    for (const m of msgs) {
      const el = elements.get(m.id);
      const where = `conversation ${conv} seq ${m.seq}`;
      if (!el) {
        details.push(`${where}: no element ${m.id}`);
        continue;
      }
      const kind = m.role === "user" ? "question" : "answer";
      const text = m.role === "ai" && m.status === "pending" ? el.text : m.content;
      if (el.kind !== kind || el.text !== text || el.created_at.getTime() !== m.created_at.getTime()) {
        details.push(`${where}: role, text or time differs`);
      }
      if (m.role === "ai") {
        if (lastUser && el.parent_id !== lastUser.id) details.push(`${where}: answer not under its message`);
        if (m.status === "complete") newestComplete = m;
      } else {
        if (lastUser) {
          const expected = newestComplete?.id ?? lastUser.id;
          if (el.parent_id !== expected) details.push(`${where}: message doesn't follow the conversation`);
        }
        lastUser = m;
        newestComplete = null;
      }
    }
  }
  return { name: "Text reproduction (SC-001)", ok: details.length === 0, details: details.slice(0, MAX_DETAILS) };
}

/** 2. Every complete v1 reply's context, rebuilt from v2 paths, is the same ordered turns. */
export async function replyContext(db: Q): Promise<Check> {
  const { live, markers, messages } = await load(db);
  const byId = new Map(messages.map((m) => [m.id, m]));
  const turn = (m: Msg): ChatTurn => ({ role: m.role, content: m.content });
  // v1: each ancestor's live complete messages up to the branch point (one before it for a
  // quick branch, whose first message repeats the anchor), then the conversation's own.
  const inherited = (conv: string): ChatTurn[] => {
    const marker = markers.get(conv);
    if (!marker) return [];
    const cutMsg = byId.get(marker.message_id);
    if (!cutMsg) return [];
    const cut = marker.kind === "whole_message" ? cutMsg.seq - 1 : cutMsg.seq;
    const own = (live.get(marker.parent_node_id) ?? []).filter((m) => m.seq <= cut && m.status === "complete");
    return [...inherited(marker.parent_node_id), ...own.map(turn)];
  };
  const details: string[] = [];
  let checked = 0;
  for (const [conv, msgs] of live) {
    const base = inherited(conv);
    for (const reply of msgs) {
      if (reply.role !== "ai" || reply.status !== "complete") continue;
      const own = msgs.filter((m) => m.seq < reply.seq && m.status === "complete").map(turn);
      const expected = [...base, ...own];
      const actual = (await buildReplyInput(reply.id, db)).messages;
      checked++;
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        details.push(`reply ${reply.id}: ${actual.length} turns, v1 had ${expected.length}`);
      }
    }
  }
  return { name: `Reply context unchanged (${checked} replies)`, ok: details.length === 0, details: details.slice(0, MAX_DETAILS) };
}

/** 3. Counts on both sides (SC-002). */
export async function counts(db: Q): Promise<Check> {
  const pairs: Array<[string, ReturnType<typeof sql<{ n: number }>>, ReturnType<typeof sql<{ n: number }>>]> = [
    ["selection markers / anchored edges", sql`SELECT count(*)::int AS n FROM v1.branch_markers WHERE kind = 'selection'`, sql`SELECT count(*)::int AS n FROM nodes WHERE anchor_start IS NOT NULL`],
    ["quick-branch markers / re-ask edges", sql`SELECT count(*)::int AS n FROM v1.branch_markers WHERE kind = 'whole_message'`, sql`SELECT count(*)::int AS n FROM nodes WHERE requery_of IS NOT NULL`],
    [
      "definitions / with a source element",
      sql`SELECT count(*)::int AS n FROM definitions WHERE source_message_id IS NOT NULL`,
      sql`SELECT count(*)::int AS n FROM definitions d JOIN nodes n ON n.id = d.source_id WHERE d.source_message_id IS NOT NULL`,
    ],
    ["parked tangents", sql`SELECT count(*)::int AS n FROM v1.parked_tangents`, sql`SELECT count(*)::int AS n FROM parked_tangents`],
    ["parked tangent events", sql`SELECT count(*)::int AS n FROM v1.parked_tangent_events`, sql`SELECT count(*)::int AS n FROM parked_tangent_events`],
    ["edge label versions / edge notes", sql`SELECT count(*)::int AS n FROM v1.edge_label_versions`, sql`SELECT count(*)::int AS n FROM edge_notes e JOIN v1_conversion c ON c.v2_id = e.id AND c.v1_table = 'edge_label_versions'`],
    ["placed trees", sql`SELECT count(*)::int AS n FROM v1.trees WHERE user_placed`, sql`SELECT count(*)::int AS n FROM trees t JOIN v1.trees o ON o.id = t.id WHERE t.user_placed`],
    [
      "conversation placements / kept in the ledger",
      sql`SELECT count(*)::int AS n FROM v1.nodes WHERE kind = 'conversation' AND manual_x IS NOT NULL`,
      sql`SELECT count(*)::int AS n FROM v1_conversion WHERE v1_table = 'nodes' AND v2_id IS NULL AND detail ? 'manual'`,
    ],
    [
      "feedback with a node / with an element",
      sql`SELECT count(*)::int AS n FROM feedback_items WHERE node_id IS NOT NULL`,
      sql`SELECT count(*)::int AS n FROM feedback_items WHERE node_id IS NOT NULL AND element_id IS NOT NULL`,
    ],
    ["trees", sql`SELECT count(*)::int AS n FROM v1.trees`, sql`SELECT count(*)::int AS n FROM trees t JOIN v1.trees o ON o.id = t.id AND o.project_id = t.project_id`],
    [
      "live messages / converted elements",
      sql`SELECT count(*)::int AS n FROM v1.messages`,
      sql`SELECT count(*)::int AS n FROM nodes n JOIN v1.messages m ON m.id = n.id`,
    ],
  ];
  const details: string[] = [];
  for (const [label, a, b] of pairs) {
    const [x, y] = await Promise.all([a.execute(db), b.execute(db)]);
    const v1 = x.rows[0].n;
    const v2 = y.rows[0].n;
    if (v1 !== v2) details.push(`${label}: v1 ${v1}, v2 ${v2}`);
  }
  return { name: "Counts (SC-002)", ok: details.length === 0, details };
}

/** 4. The frozen tables are byte-identical to the checksums taken at migration start (SC-003). */
export async function checksums(db: Q): Promise<Check> {
  const details: string[] = [];
  for (const [table, pk] of V1_TABLES) {
    const [{ rows: now }, { rows: then }] = await Promise.all([
      sql<{ n: string; digest: string }>`
        SELECT count(*) AS n, md5(coalesce(string_agg(row_to_json(t)::text, '' ORDER BY t.${sql.ref(pk)}), '')) AS digest
        FROM ${sql.table(`v1.${table}`)} t`.execute(db),
      sql<{ row_count: string; digest: string }>`SELECT row_count, digest FROM v1_checksums WHERE table_name = ${table}`.execute(db),
    ]);
    if (!then[0]) details.push(`${table}: no checksum recorded`);
    else if (String(now[0].n) !== String(then[0].row_count) || now[0].digest !== then[0].digest) details.push(`${table}: changed`);
  }
  return { name: "Original data unchanged (SC-003)", ok: details.length === 0, details };
}

/** 5. Converting again inserts nothing (run in a transaction that is always rolled back). */
export async function rerun(db: Q): Promise<Check> {
  let inserted = 0;
  const rollback = new Error("rollback");
  try {
    await db.transaction().execute(async (trx) => {
      const report = await convertV1(trx);
      inserted = Object.entries(report)
        .filter(([rule]) => !rule.startsWith("skipped_") && !rule.startsWith("quick_branches_on"))
        .reduce((sum, [, n]) => sum + n, 0);
      throw rollback;
    });
  } catch (err) {
    if (err !== rollback) throw err;
  }
  return { name: "Rerun is a no-op", ok: inserted === 0, details: inserted ? [`${inserted} new rows`] : [] };
}

export async function verifyV1(db: Q): Promise<Check[]> {
  return [await textReproduction(db), await replyContext(db), await counts(db), await checksums(db), await rerun(db)];
}
