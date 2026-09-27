import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { call, createFeedback, readFeedbackFile } from "./helpers";

async function seed(texts: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const text of texts) ids.push((await createFeedback({ text, view: "map" })).body.item.id);
  return ids;
}

const listTexts = async () => (await call("GET", "/api/feedback")).body.items.map((i: { text: string }) => i.text);

const ranks = async () =>
  Object.fromEntries((await db.selectFrom("feedback_items").select(["id", "rank"]).execute()).map((r) => [r.id, r.rank]));

describe("US2: browse and organize", () => {
  it("lists newest first with nothing manually placed", async () => {
    await seed(["a", "b", "c", "d"]);
    const list = (await call("GET", "/api/feedback")).body.items;
    expect(list.map((i: { text: string }) => i.text)).toEqual(["d", "c", "b", "a"]);
    expect(list.every((i: { manuallyPlaced: boolean }) => !i.manuallyPlaced)).toBe(true);
  });

  it("moves one item to the top and changes no other row (SC-006)", async () => {
    const [a, , , d] = await seed(["a", "b", "c", "d"]);
    const before = await ranks();
    const res = await call("PUT", `/api/feedback/${a}/position`, { aboveId: null, belowId: d });
    expect(res.status).toBe(200);
    expect(res.body.item.manuallyPlaced).toBe(true);
    expect(await listTexts()).toEqual(["a", "d", "c", "b"]);
    const after = await ranks();
    for (const id of Object.keys(before)) if (id !== a) expect(after[id]).toBe(before[id]);
    expect(after[a]).not.toBeNull();
  });

  it("drops between two items, and a new item still appears on top", async () => {
    const [a, b, c] = await seed(["a", "b", "c"]);
    // Shown: c, b, a. Put a between c and b.
    expect((await call("PUT", `/api/feedback/${a}/position`, { aboveId: c, belowId: b })).status).toBe(200);
    expect(await listTexts()).toEqual(["c", "a", "b"]);
    await seed(["new"]);
    expect(await listTexts()).toEqual(["new", "c", "a", "b"]);
  });

  it("keeps a strict order after many drops into the same gap", async () => {
    const [a, b, c, d] = await seed(["a", "b", "c", "d"]);
    // Shown: d, c, b, a. Repeatedly squeeze items between d and the item just below it.
    let below = c;
    for (let i = 0; i < 50; i++) {
      const moving = i % 2 === 0 ? a : b;
      if (moving === below) continue;
      expect((await call("PUT", `/api/feedback/${moving}/position`, { aboveId: d, belowId: below })).status).toBe(200);
      below = moving;
    }
    const list = await listTexts();
    expect(list[0]).toBe("d");
    expect(new Set(list).size).toBe(4);
  });

  it("rejects bad neighbours", async () => {
    const [a, b, c] = await seed(["a", "b", "c"]);
    // b is below c on screen, so "above b, below c" is backwards.
    expect((await call("PUT", `/api/feedback/${a}/position`, { aboveId: b, belowId: c })).status).toBe(422);
    expect((await call("PUT", `/api/feedback/${a}/position`, { aboveId: a, belowId: b })).status).toBe(422);
    expect((await call("PUT", `/api/feedback/${a}/position`, { aboveId: crypto.randomUUID(), belowId: null })).status).toBe(404);
    expect((await call("PUT", `/api/feedback/${crypto.randomUUID()}/position`, { aboveId: c, belowId: null })).status).toBe(404);
    expect((await call("PUT", `/api/feedback/${a}/position`, { aboveId: null, belowId: null })).status).toBe(422);
  });

  it("writes the new order to FEEDBACK.md", async () => {
    const [a, , c] = await seed(["a", "b", "c"]);
    await call("PUT", `/api/feedback/${a}/position`, { aboveId: null, belowId: c });
    const file = await readFeedbackFile();
    const order = [...file.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
    expect(order[0]).toBe(a);
    expect(order[1]).toBe(c);
  });
});
