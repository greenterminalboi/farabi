import { describe, expect, it } from "vitest";
import { setFakeMode } from "@/server/ai/fake";
import { db } from "@/server/db/client";
import { call, newProject, startTree } from "./helpers";

// Feature 13: Premortem, Steelman and SCQA through the generic function routes.

describe("Feature 13 · methods (story 4)", () => {
  it("are listed for answers and run like Analogy: a function edge and a proposed output", async () => {
    const t = await startTree(await newProject(), "Launch plan");
    const list = await call("GET", `/api/nodes/${t.answer.id}/functions`);
    for (const [id, name] of [
      ["premortem", "Premortem"],
      ["steelman", "Steelman"],
      ["scqa", "SCQA"],
    ]) {
      expect(list.body.functions).toContainEqual({ id, name, version: 1, outputKind: id });
      const res = await call("POST", `/api/nodes/${t.answer.id}/functions/${id}/run`);
      expect(res.status).toBe(201);
      expect(res.body.edge).toMatchObject({ kind: "function", parentId: t.answer.id, functionId: id, functionName: name, functionVersion: 1, review: "proposed" });
      expect(res.body.output).toMatchObject({ kind: id, parentId: res.body.edge.id, provenance: "ai_suggested", review: "proposed", text: expect.stringMatching(new RegExp(`^Fake ${id} #\\d+$`)) });
    }
    expect((await call("GET", `/api/nodes/${t.edge.id}/functions`)).body.functions).toEqual([]);
  });

  it("store nothing when the AI fails", async () => {
    const t = await startTree(await newProject(), "Launch plan");
    const before = (await db.selectFrom("nodes").select("id").execute()).length;
    setFakeMode({ mode: "fail" });
    const res = await call("POST", `/api/nodes/${t.answer.id}/functions/premortem/run`);
    expect(res.status).toBe(503);
    expect((await db.selectFrom("nodes").select("id").execute()).length).toBe(before);
  });
});
