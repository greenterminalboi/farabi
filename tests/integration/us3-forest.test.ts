import { describe, expect, it } from "vitest";
import { call } from "./helpers";

describe("US3 forest", () => {
  it("returns every tree and node with parents, roots, anchors and placeholders", async () => {
    const t1 = await call("POST", "/api/trees", {});
    await call("POST", "/api/trees", {});
    const msg = await call("POST", `/api/nodes/${t1.body.node.id}/messages?wait=1`, { content: "q" });
    const ai = msg.body.aiMessage;
    const start = ai.content.indexOf("Containers");
    const branch = await call("POST", `/api/nodes/${t1.body.node.id}/branches`, {
      messageId: ai.id,
      start,
      end: start + 10,
      text: "Containers",
      prefix: "",
      suffix: "",
    });

    const forest = await call("GET", "/api/forest");
    expect(forest.status).toBe(200);
    expect(forest.body.trees).toHaveLength(2);
    expect(forest.body.nodes).toHaveLength(3);
    const child = forest.body.nodes.find((n: { id: string }) => n.id === branch.body.node.id);
    expect(child).toMatchObject({ parentId: t1.body.node.id, isRoot: false, anchorText: "Containers" });
    expect(child.summary).toEqual({ kind: "placeholder", text: "“Containers”" });
    const roots = forest.body.nodes.filter((n: { isRoot: boolean }) => n.isRoot);
    expect(roots).toHaveLength(2);
  });

  it("persists tree origins and validates input", async () => {
    const t = await call("POST", "/api/trees", {});
    const ok = await call("PUT", `/api/trees/${t.body.tree.id}/origin`, { x: 123.5, y: -40 });
    expect(ok.status).toBe(200);
    expect(ok.body.tree.origin).toEqual({ x: 123.5, y: -40 });

    const bad = await call("PUT", `/api/trees/${t.body.tree.id}/origin`, { x: "a", y: 0 });
    expect(bad.status).toBe(422);
    const missing = await call("PUT", `/api/trees/${crypto.randomUUID()}/origin`, { x: 0, y: 0 });
    expect(missing.status).toBe(404);
  });
});
