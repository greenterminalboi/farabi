import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { call, sendAndWait } from "./helpers";

async function treeWithChild() {
  const t = await call("POST", "/api/trees", {});
  const ai = (await sendAndWait(t.body.node.id, "q")).body.aiMessage;
  const start = ai.content.indexOf("Containers");
  const b = await call("POST", `/api/nodes/${t.body.node.id}/branches`, {
    messageId: ai.id, start, end: start + 10, text: "Containers", prefix: "", suffix: "",
  });
  return { rootId: t.body.node.id as string, childId: b.body.node.id as string };
}

const labelOf = async (id: string) =>
  (await call("GET", "/api/forest")).body.nodes.find((n: { id: string }) => n.id === id).edgeLabel;

describe("Feature 2 · US5 edge labels", () => {
  it("sets, edits and clears a label, keeping every version", async () => {
    const { childId } = await treeWithChild();
    const set = await call("PUT", `/api/nodes/${childId}/edge-label`, { text: "  requires   understanding of " });
    expect(set.status).toBe(200);
    expect(set.body.node.edgeLabel).toBe("requires understanding of");
    expect(await labelOf(childId)).toBe("requires understanding of");

    await call("PUT", `/api/nodes/${childId}/edge-label`, { text: "builds on" });
    expect(await labelOf(childId)).toBe("builds on");

    await call("PUT", `/api/nodes/${childId}/edge-label`, { text: "  " });
    expect(await labelOf(childId)).toBeNull();

    const versions = await db.selectFrom("edge_label_versions").selectAll().orderBy("created_at").execute();
    expect(versions.map((v) => v.text)).toEqual(["requires understanding of", "builds on", null]);
    expect(versions.every((v) => v.provenance === "user_authored")).toBe(true);
  });

  it("rejects roots and over-long labels", async () => {
    const { rootId, childId } = await treeWithChild();
    const root = await call("PUT", `/api/nodes/${rootId}/edge-label`, { text: "x" });
    expect(root.status).toBe(409);
    expect(root.body.error.code).toBe("root_node");
    expect((await call("PUT", `/api/nodes/${childId}/edge-label`, { text: "x".repeat(201) })).status).toBe(422);
  });
});
