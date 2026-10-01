import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { resolveKindSettings, setKindSetting, setNodeSetting } from "@/server/settings/kindSettings";
import { call, sendAndWait } from "./helpers";
import { drainSummaries } from "@/server/summaries/queue";

/** Two analogy nodes to put overrides on. */
async function twoAnalogies() {
  const nodeId = (await call("POST", "/api/trees", {})).body.node.id as string;
  await sendAndWait(nodeId, "Pods");
  await drainSummaries();
  const a = (await call("POST", `/api/nodes/${nodeId}/functions/analogy/run`)).body.output.id as string;
  const b = (await call("POST", `/api/nodes/${nodeId}/functions/analogy/run`)).body.output.id as string;
  return { nodeId, a, b };
}

const length = async (nodeId: string | null) =>
  (await resolveKindSettings("analogy", nodeId)).find((s) => s.key === "length")!;

describe("Feature 9 · kind setting resolution (FR-030)", () => {
  it("resolves override, then kind value, then default", async () => {
    const { a, b } = await twoAnalogies();
    expect(await length(a)).toMatchObject({ value: "short", source: "default", kindValue: null, changedAt: null });

    await setKindSetting("analogy", "length", "one_line");
    expect(await length(a)).toMatchObject({ value: "one_line", source: "kind", kindValue: "one_line" });

    await setNodeSetting(a, "length", "paragraph");
    expect(await length(a)).toMatchObject({ value: "paragraph", source: "override", kindValue: "one_line" });
    expect(await length(b)).toMatchObject({ value: "one_line", source: "kind" });

    // The override still wins after the kind value changes (spec edge case).
    await setKindSetting("analogy", "length", "short");
    expect(await length(a)).toMatchObject({ value: "paragraph", source: "override", kindValue: "short" });

    await setNodeSetting(a, "length", null);
    expect(await length(a)).toMatchObject({ value: "short", source: "kind" });
    await setKindSetting("analogy", "length", null);
    expect(await length(a)).toMatchObject({ value: "short", source: "default" });
  });

  it("only accepts declared keys and values, on nodes of that kind (FR-033)", async () => {
    const { nodeId, a } = await twoAnalogies();
    await expect(setKindSetting("nope", "length", "short")).rejects.toThrow(/Unknown node kind/);
    await expect(setKindSetting("analogy", "colour", "red")).rejects.toThrow(/isn't a setting/);
    await expect(setKindSetting("analogy", "length", "novel")).rejects.toThrow(/allowed value/);
    await expect(setNodeSetting(nodeId, "length", "short")).rejects.toThrow(/isn't a setting/);
    await expect(setNodeSetting(a, "reach", "moon")).rejects.toThrow(/allowed value/);
  });

  it("records each change once, with its time (FR-032)", async () => {
    const { a } = await twoAnalogies();
    await setKindSetting("analogy", "reach", "far");
    await setKindSetting("analogy", "reach", "far");
    await setNodeSetting(a, "reach", "close");
    await setNodeSetting(a, "reach", "close");
    const rows = await db.selectFrom("kind_setting_changes").selectAll().execute();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.provenance === "user_authored" && r.created_at instanceof Date)).toBe(true);
  });
});
