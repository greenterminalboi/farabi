import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { call, sendAndWait } from "./helpers";

async function treeWithChild() {
  const t = await call("POST", "/api/trees", {});
  const msg = await sendAndWait(t.body.node.id, "q");
  const ai = msg.body.aiMessage;
  const start = ai.content.indexOf("Containers");
  const b = await call("POST", `/api/nodes/${t.body.node.id}/branches`, {
    messageId: ai.id, start, end: start + 10, text: "Containers", prefix: "", suffix: "",
  });
  return { treeId: t.body.tree.id as string, rootId: t.body.node.id as string, childId: b.body.node.id as string };
}

describe("Feature 2 · US3 positions", () => {
  it("stores a hand-placed node position and returns it in the forest", async () => {
    const { childId, rootId } = await treeWithChild();
    const res = await call("PUT", `/api/nodes/${childId}/position`, { x: 320.5, y: -40 });
    expect(res.status).toBe(200);
    expect(res.body.node.manual).toEqual({ x: 320.5, y: -40 });
    const forest = await call("GET", "/api/forest");
    const child = forest.body.nodes.find((n: { id: string }) => n.id === childId);
    expect(child.manual).toEqual({ x: 320.5, y: -40 });
    expect(child.parentId).toBe(rootId); // structure unchanged (FR-018)
  });

  it("rejects roots, bad numbers and unknown nodes", async () => {
    const { rootId, childId } = await treeWithChild();
    const root = await call("PUT", `/api/nodes/${rootId}/position`, { x: 1, y: 1 });
    expect(root.status).toBe(409);
    expect(root.body.error.code).toBe("root_node");
    expect((await call("PUT", `/api/nodes/${childId}/position`, { x: "a", y: 1 })).status).toBe(422);
    expect((await call("PUT", `/api/nodes/${crypto.randomUUID()}/position`, { x: 1, y: 1 })).status).toBe(404);
  });

  it("marks a tree user-placed when moved by the user", async () => {
    const { treeId } = await treeWithChild();
    const auto = await call("PUT", `/api/trees/${treeId}/origin`, { x: 10, y: 10 });
    expect(auto.body.tree.userPlaced).toBe(false);
    const byUser = await call("PUT", `/api/trees/${treeId}/origin`, { x: 50, y: 60, byUser: true });
    expect(byUser.body.tree).toMatchObject({ origin: { x: 50, y: 60 }, userPlaced: true });
  });

  it("never changes any parent link", async () => {
    const { childId, treeId } = await treeWithChild();
    const before = await db.selectFrom("nodes").select(["id", "parent_id"]).orderBy("id").execute();
    await call("PUT", `/api/nodes/${childId}/position`, { x: 5, y: 5 });
    await call("PUT", `/api/trees/${treeId}/origin`, { x: 5, y: 5, byUser: true });
    const after = await db.selectFrom("nodes").select(["id", "parent_id"]).orderBy("id").execute();
    expect(after).toEqual(before);
  });
});
