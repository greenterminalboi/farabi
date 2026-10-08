// The scale seed (Feature 10, SC-005, T079): one project with N graph elements over 20 trees, and
// optionally feedback items and function runs. Used by `npm run seed:large` and, in test builds,
// by POST /api/test/seed-large so e2e can seed the running app (feature 11 cut-over).
import { crc32, deflateSync } from "node:zlib";
import type { DB } from "../db/client";
import { writeAttachmentFiles } from "../feedback/attachments";
import { regenerateFeedbackFile } from "../feedback/exportFile";

export type SeedOptions = { elements?: number; feedback?: number; outputs?: number };

/** Seeds into `db` and returns a one-line summary. */
export async function seedLarge(db: DB, opts: SeedOptions = {}): Promise<string> {
  const ELEMENTS = opts.elements ?? 5000;
  const TREES = 20;
  const BRANCH_SHARE = 0.15;

  let seed = 42;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;

  const WORDS = (
    "pods containers scheduling nodes cluster network service volume replica controller state " +
    "the a of to and in is that for it as with be on not this by are or from at which an have " +
    "learning memory attention gradient model layer weights training data loss function value"
  ).split(" ");

  function sentence(words: number): string {
    const ws = Array.from({ length: words }, () => WORDS[Math.floor(rand() * WORDS.length)]);
    if (rand() < 0.3) {
      const i = Math.floor(rand() * (ws.length - 1));
      ws[i] = `**${ws[i]}**`;
    }
    const s = ws.join(" ");
    return s.charAt(0).toUpperCase() + s.slice(1) + ".";
  }

  /** Skewed length like the owner's replies: most 1,000–2,500 characters, a few up to 8,000. */
  function answerText(): string {
    const target = Math.min(8000, Math.round(300 + -Math.log(1 - rand() * 0.999) * 1400));
    const parts: string[] = [];
    let len = 0;
    while (len < target) {
      const para =
        rand() < 0.2
          ? Array.from(
              { length: 2 + Math.floor(rand() * 4) },
              () => `- ${sentence(6 + Math.floor(rand() * 10))}`,
            ).join("\n")
          : Array.from({ length: 2 + Math.floor(rand() * 4) }, () =>
              sentence(8 + Math.floor(rand() * 14)),
            ).join(" ");
      parts.push(para);
      len += para.length + 2;
    }
    return parts.join("\n\n");
  }

  const project = await db
    .insertInto("projects")
    .values({ name: "Scale seed" })
    .returning("id")
    .executeTakeFirstOrThrow();

  type Row = {
    id: string;
    tree_id: string;
    parent_id: string | null;
    kind: "question" | "answer";
    shape: "edge" | "node";
    origin: "origin" | "ask" | "branch" | "reply";
    provenance: "user_authored" | "ai_suggested";
    text: string;
    status: "complete" | null;
    anchor?: { start: number; end: number; text: string; prefix: string; suffix: string };
    depth: number;
    created_at: Date;
  };

  const rows: Row[] = [];
  const answers: Row[] = [];
  let clock = Date.UTC(2026, 9, 1);
  const tick = () => new Date((clock += 1000));

  function addPair(treeId: string, parent: Row | null, branchFrom = false): Row {
    const q: Row = {
      id: crypto.randomUUID(),
      tree_id: treeId,
      parent_id: parent?.id ?? null,
      kind: "question",
      shape: "edge",
      origin: parent ? (branchFrom ? "branch" : "ask") : "origin",
      provenance: "user_authored",
      text: sentence(6 + Math.floor(rand() * 10)).replace(/\.$/, "?"),
      status: null,
      depth: (parent?.depth ?? -1) + 1,
      created_at: tick(),
    };
    if (branchFrom && parent) {
      // Anchor the branch on a word of its parent answer.
      const at = parent.text.indexOf(" ", Math.floor(rand() * parent.text.length * 0.8)) + 1;
      const end = parent.text.indexOf(" ", at);
      if (at > 0 && end > at) {
        const text = parent.text.slice(at, end);
        if (text.trim()) {
          q.anchor = {
            start: at,
            end,
            text,
            prefix: parent.text.slice(Math.max(0, at - 32), at),
            suffix: parent.text.slice(end, end + 32),
          };
        }
      }
      if (!q.anchor) q.origin = "ask";
    }
    const a: Row = {
      id: crypto.randomUUID(),
      tree_id: treeId,
      parent_id: q.id,
      kind: "answer",
      shape: "node",
      origin: "reply",
      provenance: "ai_suggested",
      text: answerText(),
      status: "complete",
      depth: q.depth + 1,
      created_at: tick(),
    };
    rows.push(q, a);
    answers.push(a);
    return a;
  }

  const trees: Array<{ id: string; tip: Row }> = [];
  for (let t = 0; t < TREES; t++) {
    const treeId = crypto.randomUUID();
    await db
      .insertInto("trees")
      .values({ id: treeId, project_id: project.id, layout_origin_x: t * 6000, layout_origin_y: 0 })
      .execute();
    trees.push({ id: treeId, tip: addPair(treeId, null) });
  }
  while (rows.length < ELEMENTS) {
    const tree = trees[Math.floor(rand() * trees.length)];
    if (rand() < BRANCH_SHARE) {
      const from = answers.filter((a) => a.tree_id === tree.id)[
        Math.floor(rand() * answers.filter((a) => a.tree_id === tree.id).length)
      ];
      addPair(tree.id, from, true);
    } else tree.tip = addPair(tree.id, tree.tip);
  }

  // Parents first: each depth in its own statements, so the shape trigger always finds the parent.
  const byDepth = new Map<number, Row[]>();
  for (const r of rows) byDepth.set(r.depth, [...(byDepth.get(r.depth) ?? []), r]);
  for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
    const level = byDepth.get(depth)!;
    for (let i = 0; i < level.length; i += 500) {
      await db
        .insertInto("nodes")
        .values(
          level.slice(i, i + 500).map((r) => ({
            id: r.id,
            project_id: project.id,
            tree_id: r.tree_id,
            parent_id: r.parent_id,
            kind: r.kind,
            shape: r.shape,
            origin: r.origin,
            provenance: r.provenance,
            text: r.text,
            status: r.status,
            pressure_level: r.kind === "answer" ? 8 : null,
            anchor_start: r.anchor?.start ?? null,
            anchor_end: r.anchor?.end ?? null,
            anchor_text: r.anchor?.text ?? null,
            anchor_prefix: r.anchor?.prefix ?? null,
            anchor_suffix: r.anchor?.suffix ?? null,
            sent_at: r.kind === "question" ? r.created_at : null,
            created_at: r.created_at,
          })),
        )
        .execute();
    }
  }

  // A few notes on edges (FR-040).
  const noted = rows.filter((r) => r.kind === "question" && r.parent_id).slice(0, 20);
  if (noted.length)
    await db
      .insertInto("edge_notes")
      .values(noted.map((r) => ({ edge_id: r.id, text: "builds on" })))
      .execute();

  // Feature 3: feedback items for the panel scale check.
  const FEEDBACK = opts.feedback ?? 0;

  /** A solid-colour RGB PNG, like a real screenshot in size (encoded with zlib, no image library). */
  function solidPng(
    width: number,
    height: number,
    [r, g, b]: [number, number, number],
  ): Uint8Array {
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

  const TAGS = ["canvas", "text", "layout", "Map View", "streaming", "definitions"];
  for (let i = 0; i < FEEDBACK; i++) {
    const id = crypto.randomUUID();
    const el = rows[i % rows.length];
    const onElement = i % 2 === 0;
    await db
      .insertInto("feedback_items")
      .values({
        id,
        text: `Feedback ${i}: something about ${onElement ? "this answer" : "the canvas"}.\nSecond line with detail.`,
        view: "canvas",
        project_id: project.id,
        element_id: onElement ? el.id : null,
        provenance: "user_authored",
      })
      .execute();
    for (const tag of [TAGS[i % TAGS.length], TAGS[(i + 2) % TAGS.length]]) {
      await db
        .insertInto("feedback_tags")
        .values({ item_id: id, text: tag, tag_key: tag.toLowerCase(), provenance: "user_authored" })
        .execute();
    }
    await db
      .insertInto("feedback_state_events")
      .values({ item_id: id, state: "open", provenance: "user_authored" })
      .execute();
    if (i % 5 === 1) {
      await db
        .insertInto("feedback_state_events")
        .values({ item_id: id, state: "addressed", provenance: "ai_suggested" })
        .execute();
    }
    if (i % 3 === 0) {
      const png = solidPng(1280, 800, [(i * 40) % 256, 120, 200]);
      const rows = await writeAttachmentFiles(
        id,
        [{ bytes: png, name: `shot-${i}.png`, thumb: null, mimeType: "image/png" }],
        [],
      );
      for (const row of rows) {
        await db
          .insertInto("feedback_attachments")
          .values({ ...row, item_id: id, provenance: "user_authored" })
          .execute();
      }
    }
  }
  if (FEEDBACK > 0) await regenerateFeedbackFile(db);

  // Analogy on the first N answers: a function edge and one output under it (FR-048).
  const OUTPUTS = opts.outputs ?? 0;
  for (const source of answers.slice(0, OUTPUTS)) {
    const common = {
      project_id: project.id,
      tree_id: source.tree_id,
      provenance: "ai_suggested" as const,
      origin: "run" as const,
      function_id: "analogy",
      function_version: 2,
    };
    await db.transaction().execute(async (trx) => {
      const edge = await trx
        .insertInto("nodes")
        .values({ ...common, parent_id: source.id, kind: "function", shape: "edge" })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("nodes")
        .values({
          ...common,
          parent_id: edge.id,
          kind: "analogy",
          shape: "node",
          text: "Like a library card catalogue for this topic.",
        })
        .execute();
    });
  }

  return `Seeded ${TREES} trees, ${rows.length} elements, ${FEEDBACK} feedback items, ${OUTPUTS} function runs.`;
}
