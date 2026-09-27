// Seeds 20 trees with 500 nodes total for the scale check (quickstart scenario 8).
// `--feedback N` also seeds N feedback items, about a third with a screenshot (Feature 3, SC-008).
import { crc32, deflateSync } from "node:zlib";
import { createDb } from "../src/server/db/client";
import { writeAttachmentFiles } from "../src/server/feedback/attachments";
import { regenerateFeedbackFile } from "../src/server/feedback/exportFile";
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

// Feature 3: feedback items for the panel scale check.
const feedbackArg = process.argv.indexOf("--feedback");
const FEEDBACK = feedbackArg >= 0 ? Number(process.argv[feedbackArg + 1]) : 0;

/** A solid-colour RGB PNG, like a real screenshot in size (encoded with zlib, no image library). */
function solidPng(width: number, height: number, [r, g, b]: [number, number, number]): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(pixels)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

const TAGS = ["map", "chat", "layout", "Map View", "streaming", "definitions"];
for (let i = 0; i < FEEDBACK; i++) {
  const id = crypto.randomUUID();
  const node = all[i % all.length];
  const inChat = i % 2 === 0;
  await db
    .insertInto("feedback_items")
    .values({
      id,
      text: `Feedback ${i}: something about ${inChat ? "this conversation" : "the map"}.\nSecond line with detail.`,
      view: inChat ? "chat" : "map",
      node_id: inChat ? node.id : null,
      provenance: "user_authored",
    })
    .execute();
  for (const tag of [TAGS[i % TAGS.length], TAGS[(i + 2) % TAGS.length]]) {
    await db
      .insertInto("feedback_tags")
      .values({ item_id: id, text: tag, tag_key: tag.toLowerCase(), provenance: "user_authored" })
      .execute();
  }
  await db.insertInto("feedback_state_events").values({ item_id: id, state: "open", provenance: "user_authored" }).execute();
  if (i % 5 === 1) {
    await db.insertInto("feedback_state_events").values({ item_id: id, state: "addressed", provenance: "ai_suggested" }).execute();
  }
  if (i % 3 === 0) {
    const png = solidPng(1280, 800, [(i * 40) % 256, 120, 200]);
    const rows = await writeAttachmentFiles(id, [{ bytes: png, name: `shot-${i}.png`, thumb: null, mimeType: "image/png" }], []);
    for (const row of rows) {
      await db.insertInto("feedback_attachments").values({ ...row, item_id: id, provenance: "user_authored" }).execute();
    }
  }
}
if (FEEDBACK > 0) await regenerateFeedbackFile(db);

console.log(`Seeded ${TREES} trees, ${all.length} nodes, ${defs.length} definitions, ${FEEDBACK} feedback items.`);
await db.destroy();
