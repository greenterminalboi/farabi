import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { V1_TABLES } from "@/server/db/migrations/0010_message_graph";
import { backfillAfterConversion, convertV1, derivedId, recordChecksums } from "@/server/db/v1/convert";
import { verifyV1 } from "@/server/db/v1/verify";
import { type V1Fixture, seedV1 } from "./fixtures";

// The v1 → v2 conversion on a fixture covering every rule (contracts/migration.md "Fixture
// coverage"; FR-063–FR-067; SC-001–SC-003).

const id = () => crypto.randomUUID();
let clock = Date.UTC(2026, 8, 1, 9, 0, 0);
const at = () => new Date((clock += 60_000));

type Msg = NonNullable<V1Fixture["messages"]>[number];

function build() {
  const project = id();
  const trashed = id();
  const f: Required<Pick<V1Fixture, "trees" | "nodes" | "messages" | "branch_markers" | "node_summaries" | "edge_label_versions" | "parked_tangents" | "parked_tangent_events" | "pipes" | "function_output_versions" | "function_output_events" | "kind_setting_changes">> = {
    trees: [],
    nodes: [],
    messages: [],
    branch_markers: [],
    node_summaries: [],
    edge_label_versions: [],
    parked_tangents: [],
    parked_tangent_events: [],
    pipes: [],
    function_output_versions: [],
    function_output_events: [],
    kind_setting_changes: [],
  };
  const conv = (treeId: string, parentId: string | null, extra: Partial<NonNullable<V1Fixture["nodes"]>[number]> = {}) => {
    const n = { id: id(), tree_id: treeId, parent_id: parentId, provenance: "user_authored" as const, manual_x: null, manual_y: null, kind: "conversation", origin: parentId ? ("branch" as const) : ("root" as const), function_id: null, function_version: null, created_at: at(), ...extra };
    f.nodes.push(n);
    return n.id as string;
  };
  const seqs = new Map<string, number>();
  const msg = (nodeId: string, role: "user" | "ai", content: string, extra: Partial<Msg> = {}) => {
    const seq = extra.seq ?? (seqs.get(nodeId) ?? 0) + 1;
    seqs.set(nodeId, seq);
    const m = {
      id: id(),
      node_id: nodeId,
      seq,
      role,
      content,
      status: "complete" as const,
      provenance: role === "user" ? ("user_authored" as const) : ("ai_suggested" as const),
      replaced_at: null,
      replaced_by: null,
      partial_content: null,
      pressure_level: role === "ai" ? 6 : null,
      reply_model: null,
      created_at: at(),
      ...extra,
    };
    f.messages.push(m);
    return m as Msg & { id: string; content: string; created_at: Date };
  };
  const marker = (parent: string, message: { id: string; content: string }, child: string, phrase: string | null) => {
    const start = phrase ? message.content.indexOf(phrase) : 0;
    const end = phrase ? start + phrase.length : message.content.length;
    f.branch_markers.push({
      id: id(),
      parent_node_id: parent,
      message_id: message.id,
      child_node_id: child,
      start_offset: start,
      end_offset: end,
      anchor_text: message.content.slice(start, end),
      prefix: phrase ? message.content.slice(Math.max(0, start - 32), start) : "",
      suffix: phrase ? message.content.slice(end, end + 32) : "",
      kind: phrase ? "selection" : "whole_message",
      provenance: "user_authored",
      created_at: at(),
    });
  };

  // A hand-placed tree whose root conversation is hand-placed too, with 3+ exchanges, a regenerated
  // reply, a stopped reply followed by another message, and a retried failed reply.
  const treeA = id();
  const root = id();
  f.trees.push({ id: treeA, project_id: project, root_node_id: root, layout_origin_x: 400, layout_origin_y: 120, user_placed: true, created_at: at() });
  f.nodes.push({ id: root, tree_id: treeA, parent_id: null, provenance: "user_authored", manual_x: 50, manual_y: 60, kind: "conversation", origin: "root", function_id: null, function_version: null, created_at: at() });
  const u1 = msg(root, "user", "What are pods?");
  const a1 = msg(root, "ai", "Pods are **groups** of containers that share a network.");
  const u2 = msg(root, "user", "And services?");
  const a2old = msg(root, "ai", "Services route traffic.", { seq: 4 });
  const a2 = msg(root, "ai", "Services give pods a stable address.", { seq: 4 });
  a2old.replaced_at = a2.created_at;
  a2old.replaced_by = a2.id;
  const u3 = msg(root, "user", "What about volumes?", { seq: 5 });
  const a3 = msg(root, "ai", "Volumes are", { status: "stopped", seq: 6 });
  const u4 = msg(root, "user", "Go on after the stop", { seq: 7 });
  const a4old = msg(root, "ai", "", { status: "failed", seq: 8 });
  const a4 = msg(root, "ai", "Volumes persist data beyond a container.", { seq: 8 });
  a4old.replaced_at = a4.created_at;
  a4old.replaced_by = a4.id;

  // A selection branch on an answer, with two edge-label versions.
  const onAnswer = conv(treeA, root);
  marker(root, a1, onAnswer, "groups");
  const bu = msg(onAnswer, "user", "Why groups?");
  const ba = msg(onAnswer, "ai", "Because they schedule together.");
  f.edge_label_versions.push(
    { id: id(), child_node_id: onAnswer, text: "builds on", provenance: "user_authored", created_at: at() },
    { id: id(), child_node_id: onAnswer, text: "contrasts", provenance: "user_authored", created_at: at() },
  );
  // A selection branch on the user's own message.
  const onUser = conv(treeA, root);
  marker(root, u2, onUser, "services");
  msg(onUser, "user", "Which kinds of services?");
  msg(onUser, "ai", "ClusterIP, NodePort and LoadBalancer.");
  // A quick branch re-asking u3.
  const quick = conv(treeA, root, { origin: "quick_branch" });
  marker(root, u3, quick, null);
  msg(quick, "user", u3.content);
  msg(quick, "ai", "Volumes are directories mounted into pods.");
  // An empty branch.
  const empty = conv(treeA, root);
  marker(root, a1, empty, "containers");
  // A parked tangent fired with a question, and a live one.
  const fired = conv(treeA, root, { origin: "parked" });
  marker(root, a1, fired, "network");
  msg(fired, "user", "Why a shared network?");
  msg(fired, "ai", "So containers talk over localhost.");
  const tFired = id();
  const tLive = id();
  const start = a1.content.indexOf("network");
  f.parked_tangents.push(
    { id: tFired, node_id: root, message_id: a1.id, start_offset: start, end_offset: start + 7, anchor_text: "network", prefix: "", suffix: "", created_at: at() },
    { id: tLive, node_id: root, message_id: a2.id, start_offset: 0, end_offset: 8, anchor_text: "Services", prefix: "", suffix: "", created_at: at() },
  );
  f.parked_tangent_events.push(
    { id: id(), tangent_id: tFired, kind: "question_set", question: "Why a shared network?", child_node_id: null, created_at: at() },
    { id: id(), tangent_id: tFired, kind: "fired", question: null, child_node_id: fired, created_at: at() },
    { id: id(), tangent_id: tLive, kind: "question_set", question: "Later", child_node_id: null, created_at: at() },
  );

  // A Feature 9 Analogy with two versions, the second confirmed, a kind-level setting and an override.
  const summary = id();
  f.node_summaries.push({ id: summary, node_id: root, text: "About pods.", provenance: "ai_suggested", through_message_id: a2.id, created_at: at() });
  const output = id();
  const pipe = id();
  f.nodes.push(
    { id: output, tree_id: treeA, parent_id: null, provenance: "ai_suggested", manual_x: 900, manual_y: 10, kind: "analogy", origin: "function", function_id: "analogy", function_version: 1, created_at: at() },
    { id: pipe, tree_id: treeA, parent_id: null, provenance: "ai_suggested", manual_x: null, manual_y: null, kind: "pipe", origin: "function", function_id: "analogy", function_version: 1, created_at: at() },
  );
  f.pipes.push({ node_id: pipe, input_node_id: root, output_node_id: output, reads: "summary", function_id: "analogy", function_version: 1, created_at: at() });
  const v1 = id();
  const v2 = id();
  f.function_output_versions.push(
    { id: v1, output_node_id: output, text: "Like a pod of whales.", source_version: summary, function_version: 1, settings: JSON.stringify({ reach: "everyday" }), created_at: at() },
    { id: v2, output_node_id: output, text: "Like flatmates sharing a kitchen.", source_version: summary, function_version: 1, settings: JSON.stringify({ reach: "everyday" }), created_at: at() },
  );
  const confirmEvent = id();
  f.function_output_events.push({ id: confirmEvent, output_node_id: output, kind: "confirmed", version_id: v2, provenance: "user_confirmed", created_at: at() });
  const kindLevel = id();
  const override = id();
  f.kind_setting_changes.push(
    { id: kindLevel, kind: "analogy", key: "reach", node_id: null, value: JSON.stringify("far"), created_at: at() },
    { id: override, kind: "analogy", key: "length", node_id: output, value: JSON.stringify("paragraph"), created_at: at() },
  );

  // A tree in a trashed project.
  const treeB = id();
  const rootB = id();
  f.trees.push({ id: treeB, project_id: trashed, root_node_id: rootB, layout_origin_x: 3000, layout_origin_y: 0, user_placed: false, created_at: at() });
  f.nodes.push({ id: rootB, tree_id: treeB, parent_id: null, provenance: "user_authored", manual_x: null, manual_y: null, kind: "conversation", origin: "root", function_id: null, function_version: null, created_at: at() });
  msg(rootB, "user", "Old trashed question");
  msg(rootB, "ai", "Old trashed answer");

  return { f, project, trashed, root, onAnswer, onUser, quick, empty, fired, output, pipe, summary, v1, v2, confirmEvent, kindLevel, override, tFired, tLive, msgs: { u1, a1, u2, a2old, a2, u3, a3, u4, a4old, a4, bu, ba } };
}

async function setup() {
  const x = build();
  await db.insertInto("projects").values([{ id: x.project, name: "Converted" }, { id: x.trashed, name: "Old", trashed_at: new Date() }]).execute();
  await seedV1(x.f);
  // Live rows that point at v1: two definitions and feedback with and without a node.
  await sql`INSERT INTO definitions (project_id, term, term_key, source_node_id, source_message_id) VALUES
    (${x.project}, 'groups', 'groups', ${x.root}, ${x.msgs.a1.id}),
    (${x.project}, 'schedule', 'schedule', ${x.onAnswer}, ${x.msgs.ba.id})`.execute(db);
  await sql`INSERT INTO feedback_items (text, view, node_id, provenance) VALUES
    ('About this branch', 'chat', ${x.onAnswer}, 'user_authored'),
    ('About the map', 'map', NULL, 'user_authored')`.execute(db);
  // What the migration does: checksums, conversion, backfills. The migration backfills before it
  // freezes the feedback columns; this database is already past that step.
  const report = await db.transaction().execute(async (trx) => {
    await recordChecksums(trx, V1_TABLES);
    const r = await convertV1(trx);
    await sql`ALTER TABLE feedback_items DISABLE TRIGGER feedback_items_rank_only`.execute(trx);
    await backfillAfterConversion(trx);
    await sql`ALTER TABLE feedback_items ENABLE TRIGGER feedback_items_rank_only`.execute(trx);
    return r;
  });
  const el = async (eid: string) => db.selectFrom("nodes").selectAll().where("id", "=", eid).executeTakeFirst();
  return { ...x, report, el };
}

describe("Feature 10 · v1 conversion", () => {
  it("converts every rule with the right parents, origins, anchors and ids", async () => {
    const x = await setup();
    const { el, msgs: m } = x;

    // Trees keep their id, project, origin and placement.
    const tree = await db.selectFrom("trees").selectAll().where("id", "=", x.f.trees[0].id!).executeTakeFirstOrThrow();
    expect(tree).toMatchObject({ project_id: x.project, layout_origin_x: 400, layout_origin_y: 120, user_placed: true });

    // The root conversation: an origin edge, answers under their messages, attempts as siblings.
    expect(await el(m.u1.id)).toMatchObject({ kind: "question", origin: "origin", parent_id: null, text: m.u1.content, provenance: "user_authored" });
    expect((await el(m.u1.id))!.sent_at!.getTime()).toBe((m.u1.created_at as Date).getTime());
    expect(await el(m.a1.id)).toMatchObject({ kind: "answer", origin: "reply", parent_id: m.u1.id, status: "complete", pressure_level: 6, provenance: "ai_suggested" });
    expect(await el(m.u2.id)).toMatchObject({ origin: "ask", parent_id: m.a1.id });
    expect(await el(m.a2old.id)).toMatchObject({ parent_id: m.u2.id, origin: "reply", status: "complete" });
    expect(await el(m.a2.id)).toMatchObject({ parent_id: m.u2.id, origin: "regenerate" });
    expect(await el(m.u3.id)).toMatchObject({ parent_id: m.a2.id });
    expect(await el(m.a3.id)).toMatchObject({ parent_id: m.u3.id, status: "stopped", text: "Volumes are" });
    // After a stopped reply the next message follows the previous message (two in a row).
    expect(await el(m.u4.id)).toMatchObject({ parent_id: m.u3.id });
    expect(await el(m.a4old.id)).toMatchObject({ parent_id: m.u4.id, status: "failed", origin: "reply" });
    expect(await el(m.a4.id)).toMatchObject({ parent_id: m.u4.id, origin: "retry", status: "complete" });

    // Branches.
    const branchEdge = (convId: string) => x.f.messages.find((msg) => msg.node_id === convId && msg.role === "user")!.id as string;
    expect(await el(branchEdge(x.onAnswer))).toMatchObject({ origin: "branch", parent_id: m.a1.id, anchor_text: "groups", anchor_start: m.a1.content.indexOf("groups") });
    expect(await el(branchEdge(x.onUser))).toMatchObject({ origin: "branch", parent_id: m.u2.id, anchor_text: "services" });
    expect(await el(branchEdge(x.quick))).toMatchObject({ origin: "quick_branch", parent_id: m.a2.id, requery_of: m.u3.id, anchor_text: null });
    expect(await el(x.empty)).toMatchObject({ kind: "question", origin: "branch", text: null, parent_id: m.a1.id, anchor_text: "containers" });
    expect(await el(branchEdge(x.fired))).toMatchObject({ origin: "parked", parent_id: m.a1.id, anchor_text: "network" });

    // Notes, parked tangents and their events.
    const notes = await db.selectFrom("edge_notes").select(["edge_id", "text"]).orderBy("created_at").execute();
    expect(notes).toEqual([
      { edge_id: branchEdge(x.onAnswer), text: "builds on" },
      { edge_id: branchEdge(x.onAnswer), text: "contrasts" },
    ]);
    expect(await db.selectFrom("parked_tangents").select(["id", "node_id"]).orderBy("created_at").execute()).toEqual([
      { id: x.tFired, node_id: m.a1.id },
      { id: x.tLive, node_id: m.a2.id },
    ]);
    const firedEvent = await db.selectFrom("parked_tangent_events").selectAll().where("kind", "=", "fired").executeTakeFirstOrThrow();
    expect(firedEvent.edge_id).toBe(branchEdge(x.fired));

    // The Analogy: a function edge under the summary's answer, one output per version, reviews.
    expect(await el(x.pipe!)).toMatchObject({ kind: "function", shape: "edge", origin: "run", parent_id: m.a2.id, function_id: "analogy" });
    const second = derivedId("function_output_versions", x.v2, 0);
    expect(await el(x.output)).toMatchObject({ kind: "analogy", parent_id: x.pipe, text: "Like a pod of whales.", manual_x: 900, manual_y: 10 });
    expect(await el(second)).toMatchObject({ kind: "analogy", parent_id: x.pipe, text: "Like flatmates sharing a kitchen.", manual_x: null });
    expect(await db.selectFrom("output_reviews").select(["id", "node_id", "kind"]).execute()).toEqual([{ id: x.confirmEvent, node_id: second, kind: "confirmed" }]);
    const settings = await db.selectFrom("kind_setting_changes").select(["id", "node_id", "value"]).orderBy("created_at").execute();
    expect(settings).toEqual([
      { id: x.kindLevel, node_id: null, value: "far" },
      { id: x.override, node_id: x.pipe, value: "paragraph" },
    ]);

    // Hand placements of conversations are kept in the ledger only (research R4).
    const kept = await db.selectFrom("v1_conversion").select(["v2_id", "detail"]).where("v1_id", "=", x.root).where("v2_id", "is", null).executeTakeFirstOrThrow();
    expect(kept.detail).toEqual({ manual: { x: 50, y: 60 } });
    expect((await el(m.u1.id))!.manual_x).toBeNull();

    // Live rows now point at elements.
    const defs = await db.selectFrom("definitions").select(["term", "source_id"]).orderBy("term").execute();
    expect(defs).toEqual([
      { term: "groups", source_id: m.a1.id },
      { term: "schedule", source_id: m.ba.id },
    ]);
    const fb = await db.selectFrom("feedback_items").select(["node_id", "element_id", "project_id"]).where("node_id", "is not", null).executeTakeFirstOrThrow();
    expect(fb).toEqual({ node_id: x.onAnswer, element_id: branchEdge(x.onAnswer), project_id: x.project });

    // The trashed project's tree is converted too (FR-059 hides it; nothing is lost).
    expect(await db.selectFrom("trees").select("project_id").where("project_id", "=", x.trashed).execute()).toHaveLength(1);
    expect(x.report).toMatchObject({ trees: 2, origin_edges: 2, branch_edges: 2, quick_branch_edges: 1, parked_edges: 1, unsent_edges: 1, edge_notes: 2, function_edges: 1, outputs: 2 });
  });

  it("passes all five invariants, and a rerun inserts nothing", async () => {
    await setup();
    const checks = await verifyV1(db);
    for (const c of checks) expect(c, `${c.name}: ${c.details.join("; ")}`).toMatchObject({ ok: true });
    const again = await db.transaction().execute((trx) => convertV1(trx));
    const inserted = Object.entries(again)
      .filter(([rule]) => !rule.startsWith("skipped_"))
      .reduce((s, [, n]) => s + n, 0);
    expect(inserted).toBe(0);
  });

  it("detects a changed original and a missing element", async () => {
    await setup();
    // Not through the app: straight past the frozen trigger, as a broken tool might.
    await sql`ALTER TABLE v1.messages DISABLE TRIGGER v1_frozen`.execute(db);
    await sql`UPDATE v1.messages SET content = content || '!' WHERE role = 'user' AND seq = 1`.execute(db);
    await sql`ALTER TABLE v1.messages ENABLE TRIGGER v1_frozen`.execute(db);
    const checks = await verifyV1(db);
    expect(checks.find((c) => c.name.startsWith("Original data"))!.ok).toBe(false);
    expect(checks.find((c) => c.name.startsWith("Text reproduction"))!.ok).toBe(false);
  });
});
