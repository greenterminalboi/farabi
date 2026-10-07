import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { call, newProject, startTree } from "./helpers";

// Story 6: rearrange by hand and keep notes on edges (FR-037–FR-040; T080, adapting Feature 2's
// position and edge-label suites).

const canvas = async (projectId: string) => (await call("GET", `/api/canvas?projectId=${projectId}`)).body;

describe("Feature 10 · arranging (story 6)", () => {
  it("places an element relative to its tree without touching structure, and refuses the origin", async () => {
    const projectId = await newProject();
    const t = await startTree(projectId, "Pods");
    const res = await call("PUT", `/api/nodes/${t.answer.id}/position`, { x: 12.5, y: -40 });
    expect(res.status).toBe(200);
    expect(res.body.element.manual).toEqual({ x: 12.5, y: -40 });
    expect(res.body.element.parentId).toBe(t.edge.id);
    const origin = await call("PUT", `/api/nodes/${t.edge.id}/position`, { x: 1, y: 1 });
    expect(origin.status).toBe(409);
    expect(origin.body.error.code).toBe("origin_edge");
    expect((await call("PUT", `/api/nodes/${t.answer.id}/position`, { x: "a", y: 1 })).status).toBe(422);
  });

  it("moves a tree and marks it placed by the user", async () => {
    const projectId = await newProject();
    const t = await startTree(projectId, "Pods");
    const res = await call("PUT", `/api/trees/${t.tree.id}/origin`, { x: 300, y: 200 });
    expect(res.body.tree).toEqual({ id: t.tree.id, origin: { x: 300, y: 200 }, userPlaced: true, rootAnswerId: t.answer.id });
  });

  it("notes an edge, keeping every version; clears it; refuses nodes and long notes (FR-040)", async () => {
    const projectId = await newProject();
    const t = await startTree(projectId, "Pods");
    expect((await call("PUT", `/api/edges/${t.edge.id}/note`, { text: "  builds   on " })).body.edge.note).toBe("builds on");
    expect((await call("PUT", `/api/edges/${t.edge.id}/note`, { text: "contrasts" })).body.edge.note).toBe("contrasts");
    expect((await call("PUT", `/api/edges/${t.edge.id}/note`, { text: " " })).body.edge.note).toBeNull();
    const rows = await db.selectFrom("edge_notes").select(["text", "provenance"]).orderBy("created_at").execute();
    expect(rows).toEqual([
      { text: "builds on", provenance: "user_authored" },
      { text: "contrasts", provenance: "user_authored" },
      { text: null, provenance: "user_authored" },
    ]);
    await call("PUT", `/api/edges/${t.edge.id}/note`, { text: "current" });
    const c = await canvas(projectId);
    expect(c.elements.find((e: { id: string }) => e.id === t.edge.id).note).toBe("current");
    expect((await call("PUT", `/api/edges/${t.answer.id}/note`, { text: "x" })).body.error.code).toBe("not_an_edge");
    expect((await call("PUT", `/api/edges/${t.edge.id}/note`, { text: "x".repeat(201) })).status).toBe(422);
  });

  it("saves the camera per project and returns it with the canvas (FR-028)", async () => {
    const projectId = await newProject();
    const res = await call("PUT", `/api/projects/${projectId}/camera`, { x: 10, y: -20, scale: 0.5 });
    expect(res.body.camera).toEqual({ x: 10, y: -20, scale: 0.5 });
    await call("PUT", `/api/projects/${projectId}/camera`, { x: 1, y: 2, scale: 2 });
    expect((await canvas(projectId)).camera).toEqual({ x: 1, y: 2, scale: 2 });
    expect((await call("PUT", `/api/projects/${projectId}/camera`, { x: 0, y: 0, scale: 9 })).status).toBe(422);
  });

  it("never lets a position change touch structure (FR-037)", async () => {
    const projectId = await newProject();
    const t = await startTree(projectId, "Pods");
    const before = await db.selectFrom("nodes").selectAll().where("id", "=", t.answer.id).executeTakeFirstOrThrow();
    await call("PUT", `/api/nodes/${t.answer.id}/position`, { x: 1, y: 2 });
    const after = await db.selectFrom("nodes").selectAll().where("id", "=", t.answer.id).executeTakeFirstOrThrow();
    expect({ ...after, manual_x: null, manual_y: null }).toEqual({ ...before, manual_x: null, manual_y: null });
    // The database refuses a move that would re-parent, however it is attempted.
    await expect(sql`UPDATE nodes SET manual_x = 5, manual_y = 5, parent_id = NULL WHERE id = ${t.answer.id}`.execute(db)).rejects.toThrow();
    // A tree move keeps every element's relative place.
    await call("PUT", `/api/trees/${t.tree.id}/origin`, { x: 999, y: 999 });
    const c = await canvas(projectId);
    expect(c.elements.find((e: { id: string }) => e.id === t.answer.id).manual).toEqual({ x: 1, y: 2 });
  });
});
