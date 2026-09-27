// Seeds 20 trees with 500 nodes total for the scale check (quickstart scenario 8).
import { createDb } from "../src/server/db/client";
import { loadEnv } from "./env";

loadEnv();
const useTest = process.argv.includes("--test");
const url = useTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
if (!url) throw new Error("database URL not set");
const db = createDb(url);

const TREES = 20;
const NODES = 500;
const MAX_DEPTH = 6;
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

type SeedNode = { id: string; treeId: string; depth: number; aiMessageId: string; aiContent: string };
const all: SeedNode[] = [];

async function addNode(treeId: string, parent: SeedNode | null, depth: number): Promise<SeedNode> {
  const id = crypto.randomUUID();
  await db.insertInto("nodes").values({ id, tree_id: treeId, parent_id: parent?.id ?? null, provenance: "user_authored" }).execute();
  const topic = `topic ${all.length}`;
  const turns = [
    { role: "user" as const, content: `Question about ${topic}` },
    { role: "ai" as const, content: `Answer about ${topic}. Containers are mentioned here.` },
    { role: "user" as const, content: `Follow-up on ${topic}` },
    { role: "ai" as const, content: `More on ${topic}. Scheduling is mentioned here.` },
  ];
  const inserted = await db
    .insertInto("messages")
    .values(turns.map((t, i) => ({
      node_id: id, seq: i + 1, role: t.role, content: t.content, status: "complete" as const,
      provenance: t.role === "ai" ? ("ai_suggested" as const) : ("user_authored" as const),
    })))
    .returning(["id", "role", "content"])
    .execute();
  const ai = inserted.filter((m) => m.role === "ai").at(-1)!;
  if (parent) {
    const start = parent.aiContent.indexOf("Containers");
    await db.insertInto("branch_markers").values({
      parent_node_id: parent.id, message_id: parent.aiMessageId, child_node_id: id,
      start_offset: start, end_offset: start + 10, anchor_text: "Containers",
      prefix: parent.aiContent.slice(Math.max(0, start - 32), start),
      suffix: parent.aiContent.slice(start + 10, start + 42), provenance: "user_authored",
    }).execute();
  }
  await db.insertInto("node_summaries").values({
    node_id: id, text: `About ${topic}.`, provenance: "ai_suggested", through_message_id: ai.id,
  }).execute();
  // Anchor branches on the first AI reply so later messages don't interfere.
  const firstAi = inserted.find((m) => m.role === "ai")!;
  const node = { id, treeId, depth, aiMessageId: firstAi.id, aiContent: firstAi.content };
  all.push(node);
  return node;
}

for (let t = 0; t < TREES; t++) {
  const treeId = crypto.randomUUID();
  const rootId = crypto.randomUUID();
  await db.transaction().execute(async (trx) => {
    await trx.insertInto("trees").values({ id: treeId, root_node_id: rootId, layout_origin_x: t * 2000, layout_origin_y: 0 }).execute();
    await trx.insertInto("nodes").values({ id: rootId, tree_id: treeId, parent_id: null, provenance: "user_authored" }).execute();
  });
  const turns = [
    { role: "user" as const, content: `Root question ${t}` },
    { role: "ai" as const, content: `Root answer ${t}. Containers are mentioned here.` },
  ];
  const inserted = await db.insertInto("messages").values(turns.map((x, i) => ({
    node_id: rootId, seq: i + 1, role: x.role, content: x.content, status: "complete" as const,
    provenance: x.role === "ai" ? ("ai_suggested" as const) : ("user_authored" as const),
  }))).returning(["id", "content", "role"]).execute();
  const ai = inserted.find((m) => m.role === "ai")!;
  all.push({ id: rootId, treeId, depth: 0, aiMessageId: ai.id, aiContent: ai.content });
}

while (all.length < NODES) {
  const candidates = all.filter((n) => n.depth < MAX_DEPTH);
  const parent = candidates[Math.floor(rand() * candidates.length)];
  await addNode(parent.treeId, parent, parent.depth + 1);
}

// Feature 2: 500 definitions (one draft each) and a few edge labels.
const DEFINITIONS = 500;
const defRows = Array.from({ length: DEFINITIONS }, (_, i) => {
  const source = all[i % all.length];
  return {
    term: `term ${i}`,
    term_key: `term ${i}`,
    source_node_id: source.id,
    source_message_id: source.aiMessageId,
  };
});
defRows[0] = { ...defRows[0], term: "Containers", term_key: "containers" };
const defs = await db.insertInto("definitions").values(defRows).returning(["id", "term"]).execute();
await db
  .insertInto("definition_versions")
  .values(
    defs.map((d) => ({
      definition_id: d.id,
      general_text: `General meaning of ${d.term}.`,
      usage_text: `How ${d.term} was used in the conversation.`,
      provenance: "ai_suggested" as const,
    })),
  )
  .execute();
const labelled = all.filter((n) => n.depth > 0).slice(0, 10);
await db
  .insertInto("edge_label_versions")
  .values(labelled.map((n) => ({ child_node_id: n.id, text: "builds on", provenance: "user_authored" as const })))
  .execute();

console.log(`Seeded ${TREES} trees, ${all.length} nodes, ${defs.length} definitions.`);
await db.destroy();
