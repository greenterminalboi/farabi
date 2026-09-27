import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { PNG_1PX } from "./fixtures";
import { createFeedback } from "./helpers";

// Articles I, II and VI, enforced by the database itself (research R8), so they hold for any
// client, including the terminal script.

async function seeded() {
  const res = await createFeedback({ text: "Guarded", view: "map", tags: ["t"], images: [{ bytes: PNG_1PX }] });
  return res.body.item.id as string;
}

const rejects = (q: Promise<unknown>) => expect(q).rejects.toThrow();

describe("feedback history is append-only in the database", () => {
  it("state events, tags and attachments cannot be updated or deleted", async () => {
    const id = await seeded();
    await rejects(sql`UPDATE feedback_state_events SET state = 'resolved' WHERE item_id = ${id}`.execute(db));
    await rejects(sql`DELETE FROM feedback_state_events WHERE item_id = ${id}`.execute(db));
    await rejects(sql`UPDATE feedback_tags SET text = 'changed' WHERE item_id = ${id}`.execute(db));
    await rejects(sql`DELETE FROM feedback_tags WHERE item_id = ${id}`.execute(db));
    await rejects(sql`UPDATE feedback_attachments SET sha256 = 'x' WHERE item_id = ${id}`.execute(db));
    await rejects(sql`DELETE FROM feedback_attachments WHERE item_id = ${id}`.execute(db));
  });

  it("an item can only have its rank changed", async () => {
    const id = await seeded();
    await rejects(sql`UPDATE feedback_items SET text = 'rewritten' WHERE id = ${id}`.execute(db));
    await rejects(sql`UPDATE feedback_items SET view = 'chat' WHERE id = ${id}`.execute(db));
    await rejects(sql`DELETE FROM feedback_items WHERE id = ${id}`.execute(db));
    await sql`UPDATE feedback_items SET rank = '000000000000001' WHERE id = ${id}`.execute(db);
    const row = await db.selectFrom("feedback_items").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
    expect(row.text).toBe("Guarded");
    expect(row.rank).toBe("000000000000001");
  });

  it("each state can only be set by its owner (Article I)", async () => {
    const id = await seeded();
    const insert = (state: string, provenance: string) =>
      sql`INSERT INTO feedback_state_events (item_id, state, provenance)
          VALUES (${id}, ${state}::feedback_state, ${provenance}::provenance)`.execute(db);
    await rejects(insert("resolved", "ai_suggested"));
    await rejects(insert("addressed", "user_confirmed"));
    await rejects(insert("addressed", "user_authored"));
    await rejects(insert("open", "ai_suggested"));
    await insert("addressed", "ai_suggested");
    await insert("resolved", "user_confirmed");
  });

  it("items, tags and attachments are always user_authored", async () => {
    await seeded();
    for (const table of ["feedback_items", "feedback_tags", "feedback_attachments"] as const) {
      const rows = await db.selectFrom(table).select("provenance").execute();
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.provenance === "user_authored")).toBe(true);
    }
  });
});
