import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { feedbackDir } from "@/server/feedback/paths";
import { pngVariant, WEBP_STUB } from "./fixtures";
import { call, callRaw, createFeedback, readFeedbackFile } from "./helpers";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const itemCount = async () => (await db.selectFrom("feedback_items").select("id").execute()).length;
const attachmentDirs = () => {
  const dir = path.join(feedbackDir(), "attachments");
  return existsSync(dir) ? readdirSync(dir) : [];
};

describe("US5: screenshots", () => {
  it("stores each image once under the item's folder, with an optional thumbnail", async () => {
    const images = [{ bytes: pngVariant(1) }, { bytes: pngVariant(2) }];
    const res = await createFeedback({ text: "Glitch", view: "map", images, thumbs: [{ bytes: WEBP_STUB }, null] });
    expect(res.status).toBe(201);
    const item = res.body.item;
    expect(item.attachments).toHaveLength(2);

    const rows = await db.selectFrom("feedback_attachments").selectAll().orderBy("created_at").execute();
    expect(rows.map((r) => r.mime_type)).toEqual(["image/png", "image/png"]);
    rows.forEach((row, i) => {
      expect(row.file_path).toBe(`attachments/${item.id}/${row.id}.png`);
      const onDisk = readFileSync(path.join(feedbackDir(), row.file_path));
      expect(sha(onDisk)).toBe(row.sha256);
      expect(sha(onDisk)).toBe(sha(images[i].bytes));
      expect(row.provenance).toBe("user_authored");
    });
    expect(rows[0].thumb_path).toBe(`attachments/${item.id}/${rows[0].id}.thumb.webp`);
    expect(rows[1].thumb_path).toBeNull();

    const file = await readFeedbackFile();
    for (const a of item.attachments) expect(file).toContain(`  - ${a.path}`);
    expect(item.attachments[0].path).toMatch(new RegExp(`attachments/${item.id}/${rows[0].id}\\.png$`));
  });

  it("serves originals and thumbnails, falling back to the original", async () => {
    const res = await createFeedback({
      text: "Serve",
      view: "map",
      images: [{ bytes: pngVariant(1) }, { bytes: pngVariant(2) }],
      thumbs: [{ bytes: WEBP_STUB }, null],
    });
    const [withThumb, withoutThumb] = res.body.item.attachments;

    const original = await callRaw("GET", withThumb.url);
    expect(original.status).toBe(200);
    expect(original.headers.get("content-type")).toBe("image/png");
    expect(original.headers.get("cache-control")).toContain("immutable");
    expect(sha(new Uint8Array(await original.arrayBuffer()))).toBe(sha(pngVariant(1)));

    const thumb = await callRaw("GET", withThumb.thumbUrl);
    expect(thumb.headers.get("content-type")).toBe("image/webp");

    const fallback = await callRaw("GET", withoutThumb.thumbUrl);
    expect(fallback.headers.get("content-type")).toBe("image/png");
    expect(sha(new Uint8Array(await fallback.arrayBuffer()))).toBe(sha(pngVariant(2)));

    expect((await callRaw("GET", `/api/feedback/attachments/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await callRaw("GET", "/api/feedback/attachments/nope")).status).toBe(404);
  });

  it("refuses too many, too large or fake images, storing nothing", async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({ bytes: pngVariant(i) }));
    expect((await createFeedback({ text: "many", view: "map", images: eleven })).status).toBe(422);

    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(pngVariant(0));
    expect((await createFeedback({ text: "big", view: "map", images: [{ bytes: big }] })).status).toBe(422);

    const fake = Uint8Array.from(Buffer.from("definitely not an image"));
    const res = await createFeedback({ text: "fake", view: "map", images: [{ bytes: fake, name: "x.png" }] });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain("not a PNG, JPEG, WebP or GIF");

    expect(await itemCount()).toBe(0);
    expect(attachmentDirs()).toHaveLength(0);
  });

  it("removes files written by a create that did not commit", async () => {
    // Make the database refuse the attachment row, after the files are already on disk.
    await sql`CREATE FUNCTION test_refuse_attachment() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'refused for test'; END $$`.execute(db);
    await sql`CREATE TRIGGER test_refuse_attachment BEFORE INSERT ON feedback_attachments
      FOR EACH ROW EXECUTE FUNCTION test_refuse_attachment()`.execute(db);
    try {
      const res = await createFeedback({
        text: "Rolled back",
        view: "map",
        images: [{ bytes: pngVariant(1) }],
        thumbs: [{ bytes: WEBP_STUB }],
      });
      expect(res.status).toBe(500);
    } finally {
      await sql`DROP TRIGGER test_refuse_attachment ON feedback_attachments`.execute(db);
      await sql`DROP FUNCTION test_refuse_attachment()`.execute(db);
    }
    expect(await itemCount()).toBe(0);
    expect(attachmentDirs()).toEqual([]);
  });

  it("keeps files unchanged after the item is resolved (FR-023)", async () => {
    const res = await createFeedback({ text: "Keep", view: "map", images: [{ bytes: pngVariant(7) }] });
    const id = res.body.item.id;
    const row = await db.selectFrom("feedback_attachments").selectAll().executeTakeFirstOrThrow();
    await call("POST", `/api/feedback/${id}/resolve`, {});
    const after = await call("GET", "/api/feedback");
    expect(after.body.items[0].attachments).toHaveLength(1);
    expect(sha(readFileSync(path.join(feedbackDir(), row.file_path)))).toBe(row.sha256);
  });
});
