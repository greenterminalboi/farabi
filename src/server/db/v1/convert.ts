// Rebuilds v1 conversations as v2 graph elements (contracts/migration.md "Conversion rules"). The
// only code, with verify.ts, that reads the frozen `v1` schema. Frozen once shipped: later
// migrations never change what it produces.
//
// Deterministic and idempotent (research R3): every v2 row reuses the id of the v1 row it came
// from, or a derived id `md5('<v1 table>:<v1 id>:<n>')`; every insert is ON CONFLICT DO NOTHING;
// every rule appends to the `v1_conversion` ledger. A rerun inserts nothing.
import { createHash } from "node:crypto";
import { type Kysely, sql } from "kysely";

/** Rows converted per rule, printed by the migration and `npm run v1:convert` (FR-067). */
export type ConversionReport = Record<string, number>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- runs inside migrations on Kysely<unknown>
type Q = Kysely<any>;

type V1Tree = { id: string; project_id: string; root_node_id: string; layout_origin_x: number; layout_origin_y: number; user_placed: boolean; created_at: Date };
type V1Node = { id: string; tree_id: string; parent_id: string | null; kind: string; origin: string; manual_x: number | null; manual_y: number | null; created_at: Date };
type V1Message = {
  id: string;
  node_id: string;
  seq: number;
  role: "user" | "ai";
  content: string;
  status: "pending" | "complete" | "failed" | "incomplete" | "stopped";
  replaced_at: Date | null;
  replaced_by: string | null;
  partial_content: string | null;
  pressure_level: number | null;
  reply_model: string | null;
  created_at: Date;
};
type V1Marker = { id: string; parent_node_id: string; message_id: string; child_node_id: string; start_offset: number; end_offset: number; anchor_text: string; prefix: string; suffix: string; kind: "selection" | "whole_message" };

/** `md5('<table>:<id>:<n>')` as a uuid, exactly as Postgres's `md5(...)::uuid` writes it. */
export function derivedId(table: string, id: string, n: number): string {
  const h = createHash("md5").update(`${table}:${id}:${n}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const byTime = <T extends { created_at: Date; id: string }>(a: T, b: T) =>
  a.created_at.getTime() - b.created_at.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export async function convertV1(db: Q): Promise<ConversionReport> {
  const report: ConversionReport = {};
  const bump = (rule: string, n = 1) => {
    if (n) report[rule] = (report[rule] ?? 0) + n;
  };

  const load = <T>(table: string) => sql<T>`SELECT * FROM ${sql.table(`v1.${table}`)}`.execute(db).then((r) => r.rows);
  const [trees, nodes, messages, markers, labels, tangents, tangentEvents, pipes, versions, events, settings, summaries] = await Promise.all([
    load<V1Tree>("trees"),
    load<V1Node>("nodes"),
    load<V1Message>("messages"),
    load<V1Marker>("branch_markers"),
    load<{ id: string; child_node_id: string; text: string | null; created_at: Date }>("edge_label_versions"),
    load<{ id: string; node_id: string; message_id: string; start_offset: number; end_offset: number; anchor_text: string; prefix: string; suffix: string; created_at: Date }>("parked_tangents"),
    load<{ id: string; tangent_id: string; kind: "question_set" | "discarded" | "fired"; question: string | null; child_node_id: string | null; created_at: Date }>("parked_tangent_events"),
    load<{ node_id: string; input_node_id: string; output_node_id: string; function_id: string; function_version: number; created_at: Date }>("pipes"),
    load<{ id: string; output_node_id: string; text: string; source_version: string; function_version: number; created_at: Date }>("function_output_versions"),
    load<{ id: string; output_node_id: string; kind: "confirmed" | "rejected"; version_id: string | null; provenance: string; created_at: Date }>("function_output_events"),
    load<{ id: string; kind: string; key: string; node_id: string | null; value: unknown; created_at: Date }>("kind_setting_changes"),
    load<{ id: string; node_id: string; through_message_id: string }>("node_summaries"),
  ]);
  if (trees.length + nodes.length + messages.length === 0 && settings.length === 0) return report;

  /** Inserts one row unless its id exists; true when it was inserted. */
  const insert = async (table: string, row: Record<string, unknown>): Promise<boolean> => {
    const res = await db.insertInto(table).values(row).onConflict((oc) => oc.column("id").doNothing()).executeTakeFirst();
    return Number(res.numInsertedOrUpdatedRows ?? 0) > 0;
  };
  /** Appends to the ledger unless the entry exists; true when it was appended. */
  const ledger = async (v1Table: string, v1Id: string, v2Id: string | null, detail: Record<string, unknown> = {}) => {
    const res = await db
      .insertInto("v1_conversion")
      .values({ v1_table: v1Table, v1_id: v1Id, v2_id: v2Id, detail: JSON.stringify(detail) })
      .onConflict((oc) => oc.columns(["v1_table", "v1_id", "v2_id"]).doNothing())
      .executeTakeFirst();
    return Number(res.numInsertedOrUpdatedRows ?? 0) > 0;
  };

  // 1. Trees: same id, project, origin and placement.
  const treeProject = new Map<string, string>();
  for (const t of trees) {
    treeProject.set(t.id, t.project_id);
    if (
      await insert("trees", {
        id: t.id,
        project_id: t.project_id,
        layout_origin_x: t.layout_origin_x,
        layout_origin_y: t.layout_origin_y,
        user_placed: t.user_placed,
        created_at: t.created_at,
      })
    )
      bump("trees");
    await ledger("trees", t.id, t.id);
  }

  // 2. Conversations, parents before children (a branch hangs off its parent's elements).
  const conversations = nodes.filter((n) => n.kind === "conversation");
  const childrenOf = new Map<string | null, V1Node[]>();
  for (const n of conversations) childrenOf.set(n.parent_id, [...(childrenOf.get(n.parent_id) ?? []), n]);
  const ordered: V1Node[] = [];
  const queue = [...(childrenOf.get(null) ?? [])].sort(byTime);
  while (queue.length) {
    const n = queue.shift()!;
    ordered.push(n);
    queue.push(...(childrenOf.get(n.id) ?? []).sort(byTime));
  }

  const messagesOf = new Map<string, V1Message[]>();
  for (const m of messages) messagesOf.set(m.node_id, [...(messagesOf.get(m.node_id) ?? []), m]);
  const markerOf = new Map(markers.map((m) => [m.child_node_id, m]));
  const firedChildren = new Set(tangentEvents.filter((e) => e.kind === "fired" && e.child_node_id).map((e) => e.child_node_id!));
  const messageById = new Map(messages.map((m) => [m.id, m]));
  /** v2 parent of each converted element, for quick branches (they hang off the re-asked edge's parent). */
  const parentOf = new Map<string, string | null>();
  /** Each conversation's first edge: the ledger target for /n/<id>, notes, feedback, fired tangents. */
  const firstEdge = new Map<string, string>();

  const element = async (row: Record<string, unknown> & { id: string; parent_id: string | null }, rule: string) => {
    parentOf.set(row.id, row.parent_id);
    if (await insert("nodes", { properties: "{}", ...row })) bump(rule);
  };

  for (const conv of ordered) {
    const projectId = treeProject.get(conv.tree_id);
    if (!projectId) {
      bump("skipped_conversations_without_tree");
      continue;
    }
    const common = { project_id: projectId, tree_id: conv.tree_id };
    const marker = markerOf.get(conv.id);
    const isRoot = conv.parent_id === null;
    const all = (messagesOf.get(conv.id) ?? []).sort((a, b) => a.seq - b.seq || byTime(a, b));

    // The conversation's first edge: where it starts, and how.
    const firstEdgeRow = (id: string, text: string | null, sentAt: Date | null, createdAt: Date) => {
      if (isRoot || !marker) {
        if (!isRoot) bump("unanchored_branches_as_origin_children");
        return {
          id,
          ...common,
          parent_id: isRoot ? null : (firstEdge.get(conv.parent_id!) ?? null),
          kind: "question",
          shape: "edge",
          origin: isRoot ? "origin" : "ask",
          provenance: "user_authored",
          text,
          sent_at: sentAt,
          created_at: createdAt,
        };
      }
      if (marker.kind === "whole_message") {
        // The re-asked edge's own source. An origin edge has none, so a re-ask of a tree's very
        // first message hangs off that message instead (counted, so verify can show it).
        const source = parentOf.get(marker.message_id) ?? null;
        if (source === null) bump("quick_branches_on_origin_edges");
        return {
          id,
          ...common,
          parent_id: source ?? marker.message_id,
          kind: "question",
          shape: "edge",
          origin: "quick_branch",
          provenance: "user_authored",
          requery_of: marker.message_id,
          text,
          sent_at: sentAt,
          created_at: createdAt,
        };
      }
      return {
        id,
        ...common,
        parent_id: marker.message_id,
        kind: "question",
        shape: "edge",
        origin: firedChildren.has(conv.id) ? "parked" : "branch",
        provenance: "user_authored",
        anchor_start: marker.start_offset,
        anchor_end: marker.end_offset,
        anchor_text: marker.anchor_text,
        anchor_prefix: marker.prefix,
        anchor_suffix: marker.suffix,
        text,
        sent_at: sentAt,
        created_at: createdAt,
      };
    };

    const firstUser = all.find((m) => m.role === "user");
    if (!firstUser) {
      // An empty conversation: an unsent edge with the v1 node's id.
      const row = firstEdgeRow(conv.id, null, null, conv.created_at);
      if (row.parent_id === null && !isRoot) {
        bump("skipped_empty_branches_without_parent");
        continue;
      }
      await element(row, isRoot ? "unsent_origin_edges" : "unsent_edges");
      firstEdge.set(conv.id, conv.id);
      await ledger("nodes", conv.id, conv.id);
    }

    // Walk the messages in order, replaced ones included (they become sibling attempts).
    let edge: string | null = null; // the current user message's edge
    let newestCompleteLive: string | null = null; // since that user message
    for (const m of all) {
      if (m.role === "user") {
        let row: Record<string, unknown> & { id: string; parent_id: string | null };
        let rule: string;
        if (m.id === firstUser!.id) {
          row = firstEdgeRow(m.id, m.content, m.created_at, m.created_at) as typeof row;
          rule = `${row.origin}_edges`;
          firstEdge.set(conv.id, m.id);
          await ledger("nodes", conv.id, m.id);
        } else {
          // A later message follows the newest complete answer, else the previous message itself
          // (two user messages in a row): v1 left unfinished replies out of the context too.
          row = {
            id: m.id,
            ...common,
            parent_id: newestCompleteLive ?? edge,
            kind: "question",
            shape: "edge",
            origin: "ask",
            provenance: "user_authored",
            text: m.content,
            sent_at: m.created_at,
            created_at: m.created_at,
          };
          rule = "ask_edges";
        }
        if (row.parent_id === null && row.origin !== "origin") {
          bump("skipped_user_messages_without_parent");
          continue;
        }
        await element(row, rule);
        await ledger("messages", m.id, m.id);
        edge = m.id;
        newestCompleteLive = null;
        continue;
      }
      // An AI message: an answer under the preceding user message's edge.
      if (!edge) {
        bump("skipped_ai_messages_before_any_user_message");
        continue;
      }
      const replaced = messages.find((r) => r.replaced_by === m.id);
      const origin = replaced ? (replaced.status === "complete" ? "regenerate" : "retry") : "reply";
      await element(
        {
          id: m.id,
          ...common,
          parent_id: edge,
          kind: "answer",
          shape: "node",
          origin,
          provenance: "ai_suggested",
          text: m.status === "pending" ? "" : m.content,
          status: m.status,
          partial_text: m.status === "pending" ? (m.partial_content ?? m.content) : null,
          pressure_level: m.pressure_level,
          reply_model: m.reply_model,
          created_at: m.created_at,
        },
        "answers",
      );
      await ledger("messages", m.id, m.id);
      if (m.replaced_at === null && m.status === "complete") newestCompleteLive = m.id;
    }

    if (conv.manual_x !== null && conv.manual_y !== null) {
      // Kept as data, not applied: a conversation-level placement doesn't fit a column (R4).
      if (await ledger("nodes", conv.id, null, { manual: { x: conv.manual_x, y: conv.manual_y } })) bump("conversation_placements_kept");
    }
  }

  // 3. Edge labels → notes on the conversation's first edge, every version in order.
  for (const l of [...labels].sort(byTime)) {
    const edgeId = firstEdge.get(l.child_node_id);
    if (!edgeId) {
      bump("skipped_edge_labels");
      continue;
    }
    const id = derivedId("edge_label_versions", l.id, 0);
    if (await insert("edge_notes", { id, edge_id: edgeId, text: l.text, created_at: l.created_at })) bump("edge_notes");
    await ledger("edge_label_versions", l.id, id);
  }

  // 4. Parked tangents on the element holding them; fired events point at the edge they made.
  for (const t of tangents) {
    if (!messageById.has(t.message_id)) {
      bump("skipped_parked_tangents");
      continue;
    }
    if (
      await insert("parked_tangents", {
        id: t.id,
        node_id: t.message_id,
        start_offset: t.start_offset,
        end_offset: t.end_offset,
        anchor_text: t.anchor_text,
        prefix: t.prefix,
        suffix: t.suffix,
        created_at: t.created_at,
      })
    )
      bump("parked_tangents");
    await ledger("parked_tangents", t.id, t.id);
  }
  for (const e of [...tangentEvents].sort(byTime)) {
    const edgeId = e.kind === "fired" && e.child_node_id ? (firstEdge.get(e.child_node_id) ?? null) : null;
    if (e.kind === "fired" && !edgeId) {
      bump("skipped_parked_events");
      continue;
    }
    if (await insert("parked_tangent_events", { id: e.id, tangent_id: e.tangent_id, kind: e.kind, question: e.question, edge_id: edgeId, created_at: e.created_at }))
      bump("parked_events");
    await ledger("parked_tangent_events", e.id, e.id);
  }

  // 5. Function outputs (Feature 9): a function edge per pipe, one output per output version.
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const summaryById = new Map(summaries.map((s) => [s.id, s]));
  const versionsOf = new Map<string, typeof versions>();
  for (const v of versions) versionsOf.set(v.output_node_id, [...(versionsOf.get(v.output_node_id) ?? []), v]);
  const outputsOf = new Map<string, string[]>(); // v1 output node → v2 outputs
  const outputOfVersion = new Map<string, string>();
  const edgeOfOutput = new Map<string, string>();
  for (const p of pipes) {
    const output = nodeById.get(p.output_node_id);
    const vs = (versionsOf.get(p.output_node_id) ?? []).sort(byTime);
    const projectId = output ? treeProject.get(output.tree_id) : undefined;
    if (!output || !projectId || vs.length === 0) {
      bump("skipped_function_runs");
      continue;
    }
    // The answer the input summary was made through; else the input's newest complete answer.
    const through = summaryById.get(vs[0].source_version)?.through_message_id;
    const fallback = (messagesOf.get(p.input_node_id) ?? [])
      .filter((m) => m.role === "ai" && m.status === "complete" && m.replaced_at === null)
      .sort((a, b) => b.seq - a.seq)[0]?.id;
    const inputAnswer = through && messageById.get(through)?.role === "ai" ? through : fallback;
    if (!inputAnswer) {
      bump("skipped_function_runs_without_answer");
      continue;
    }
    const common = { project_id: projectId, tree_id: output.tree_id, provenance: "ai_suggested", origin: "run", function_id: p.function_id };
    await element(
      { id: p.node_id, ...common, parent_id: inputAnswer, kind: "function", shape: "edge", function_version: p.function_version, created_at: p.created_at },
      "function_edges",
    );
    await ledger("pipes", p.node_id, p.node_id);
    await ledger("nodes", p.node_id, p.node_id);
    edgeOfOutput.set(p.output_node_id, p.node_id);
    const made: string[] = [];
    for (const [i, v] of vs.entries()) {
      const id = i === 0 ? p.output_node_id : derivedId("function_output_versions", v.id, 0);
      // A 009 output's hand placement carries over to its first output (contracts/migration.md).
      const placed = i === 0 && output.manual_x !== null && output.manual_y !== null ? { manual_x: output.manual_x, manual_y: output.manual_y } : {};
      await element(
        { id, ...common, parent_id: p.node_id, kind: output.kind, shape: "node", text: v.text, function_version: v.function_version, created_at: v.created_at, ...placed },
        "outputs",
      );
      await ledger("function_output_versions", v.id, id);
      made.push(id);
      outputOfVersion.set(v.id, id);
    }
    outputsOf.set(p.output_node_id, made);
    await ledger("nodes", p.output_node_id, made[0]);
  }
  for (const e of [...events].sort(byTime)) {
    const targets = e.kind === "confirmed" && e.version_id ? [outputOfVersion.get(e.version_id)].filter(Boolean) : (outputsOf.get(e.output_node_id) ?? []);
    if (targets.length === 0) {
      bump("skipped_output_events");
      continue;
    }
    for (const [i, target] of (targets as string[]).entries()) {
      const id = i === 0 ? e.id : derivedId("function_output_events", e.id, i);
      if (await insert("output_reviews", { id, node_id: target, kind: e.kind, provenance: e.provenance, created_at: e.created_at })) bump("output_reviews");
      await ledger("function_output_events", e.id, id);
    }
  }

  // 6. Kind settings: kind-level rows as they are; an override on a 009 output moves to its edge.
  for (const s of [...settings].sort(byTime)) {
    const nodeId = s.node_id === null ? null : (edgeOfOutput.get(s.node_id) ?? null);
    if (s.node_id !== null && nodeId === null) {
      bump("skipped_kind_settings");
      continue;
    }
    const value = s.value === null ? null : JSON.stringify(s.value);
    if (await insert("kind_setting_changes", { id: s.id, kind: s.kind, key: s.key, node_id: nodeId, value, created_at: s.created_at })) bump("kind_settings");
    await ledger("kind_setting_changes", s.id, s.id);
  }

  return report;
}

/** Row count and digest of each frozen table, ordered by its key (migration step 2, SC-003). */
export async function recordChecksums(db: Q, tables: Array<[string, string]>): Promise<void> {
  for (const [table, pk] of tables) {
    await sql`
      INSERT INTO v1_checksums (table_name, row_count, digest)
      SELECT ${table}, count(*), md5(coalesce(string_agg(row_to_json(t)::text, '' ORDER BY t.${sql.ref(pk)}), ''))
      FROM ${sql.table(`v1.${table}`)} t
      ON CONFLICT (table_name) DO UPDATE SET row_count = EXCLUDED.row_count, digest = EXCLUDED.digest, taken_at = now()`.execute(db);
  }
}

/**
 * Links rows of the live tables to the converted graph (migration step 5): a definition's source
 * message is now its source element, and a feedback item's conversation is now its first edge.
 */
export async function backfillAfterConversion(db: Q): Promise<void> {
  await sql`
    UPDATE definitions SET source_id = source_message_id
    WHERE source_id IS NULL AND source_message_id IN (SELECT id FROM nodes)`.execute(db);
  await sql`
    UPDATE feedback_items f SET element_id = c.v2_id, project_id = n.project_id
    FROM v1_conversion c JOIN nodes n ON n.id = c.v2_id
    WHERE c.v1_table = 'nodes' AND c.v1_id = f.node_id AND f.element_id IS NULL`.execute(db);
}

export function printReport(report: ConversionReport): void {
  const entries = Object.entries(report);
  if (entries.length === 0) {
    console.log("v1 conversion: no new rows");
    return;
  }
  console.log("v1 conversion:");
  for (const [rule, n] of entries) console.log(`  ${rule}: ${n}`);
}
