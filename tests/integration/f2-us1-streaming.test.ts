import { describe, expect, it } from "vitest";
import { setFakeMode } from "@/server/ai/fake";
import { db } from "@/server/db/client";
import { drainGenerations, waitFor } from "@/server/messages/generation";
import { drainSummaries } from "@/server/summaries/queue";
import { call, readStream, sendAndWait } from "./helpers";

async function root() {
  const res = await call("POST", "/api/trees", {});
  return res.body.node.id as string;
}

describe("Feature 2 · US1 streaming", () => {
  it("returns before the reply ends, then streams snapshot, deltas and end", async () => {
    const nodeId = await root();
    const res = await call("POST", `/api/nodes/${nodeId}/messages`, { content: "Explain Pods" });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("message");
    expect(res.body.aiMessage.status).toBe("pending");

    const events = await readStream(res.body.aiMessage.id);
    expect(events[0].event).toBe("snapshot");
    const end = events.at(-1)!;
    expect(end.event).toBe("end");
    expect(end.data.message.status).toBe("complete");
    const streamed =
      events[0].data.text + events.filter((e) => e.event === "delta").map((e) => e.data.text).join("");
    expect(streamed).toBe(end.data.message.content);
    expect(events.filter((e) => e.event === "delta").length).toBeGreaterThan(1);
  });

  it("?wait=1 returns the completed reply", async () => {
    const nodeId = await root();
    const res = await sendAndWait(nodeId, "hello");
    expect(res.body.aiMessage.status).toBe("complete");
    expect(res.body.aiMessage.content).toContain("Echo: hello");
  });

  it("Stop keeps the text so far, marked stopped", async () => {
    const nodeId = await root();
    const res = await call("POST", `/api/nodes/${nodeId}/messages`, { content: "a long answer please" });
    await new Promise((r) => setTimeout(r, 100)); // let a couple of chunks arrive
    const stop = await call("POST", `/api/messages/${res.body.aiMessage.id}/stop`, {});
    expect(stop.status).toBe(200);
    expect(stop.body.message.status).toBe("stopped");
    expect(stop.body.message.content.length).toBeGreaterThan(0);
    expect("Echo: a long answer please. Containers are mentioned here.").toContain(stop.body.message.content);
    expect((await call("POST", `/api/messages/${res.body.aiMessage.id}/stop`, {})).status).toBe(409);
  });

  it("an interrupted reply keeps its partial text, marked incomplete", async () => {
    const nodeId = await root();
    setFakeMode({ mode: "stall" });
    const res = await sendAndWait(nodeId, "interrupt me");
    expect(res.body.aiMessage.status).toBe("incomplete");
    expect(res.body.aiMessage.content.length).toBeGreaterThan(0);
    const view = await call("GET", `/api/nodes/${nodeId}`);
    expect(view.body.messages.at(-1).status).toBe("incomplete");
  });

  it("finalises an orphaned pending reply from its checkpoint", async () => {
    const nodeId = await root();
    const orphan = await db
      .insertInto("messages")
      .values({
        node_id: nodeId,
        seq: 1,
        role: "ai",
        content: "",
        status: "pending",
        provenance: "ai_suggested",
        partial_content: "half a thou",
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const view = await call("GET", `/api/nodes/${nodeId}`);
    expect(view.body.messages[0]).toMatchObject({ status: "incomplete", content: "half a thou" });
    expect((await waitFor(orphan.id)).status).toBe("incomplete");
  });

  it("retries incomplete and stopped replies as new attempts", async () => {
    const nodeId = await root();
    setFakeMode({ mode: "stall" });
    const first = await sendAndWait(nodeId, "try again");
    setFakeMode({ mode: "ok" });
    const retry = await call("POST", `/api/messages/${first.body.aiMessage.id}/retry?wait=1`, {});
    expect(retry.status).toBe(201);
    expect(retry.body.aiMessage.status).toBe("complete");
    const old = await db.selectFrom("messages").selectAll().where("id", "=", first.body.aiMessage.id).executeTakeFirstOrThrow();
    expect(old.status).toBe("incomplete");
    expect(old.replaced_by).toBe(retry.body.aiMessage.id);

    const second = await call("POST", `/api/nodes/${nodeId}/messages`, { content: "and stop" });
    await new Promise((r) => setTimeout(r, 60));
    await call("POST", `/api/messages/${second.body.aiMessage.id}/stop`, {});
    const retry2 = await call("POST", `/api/messages/${second.body.aiMessage.id}/retry?wait=1`, {});
    expect(retry2.body.aiMessage.status).toBe("complete");
  });

  it("writes a summary only after a complete reply", async () => {
    const nodeId = await root();
    setFakeMode({ mode: "stall" });
    await sendAndWait(nodeId, "cut off");
    await drainGenerations();
    await drainSummaries();
    expect(await db.selectFrom("node_summaries").selectAll().execute()).toHaveLength(0);
    setFakeMode({ mode: "ok" });
    const view = await call("GET", `/api/nodes/${nodeId}`);
    await call("POST", `/api/messages/${view.body.messages.at(-1).id}/retry?wait=1`, {});
    await drainSummaries();
    expect(await db.selectFrom("node_summaries").selectAll().execute()).toHaveLength(1);
  });
});
