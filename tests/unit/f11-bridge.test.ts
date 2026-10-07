import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Bridge, BridgeError, LINE_PREFIX, MAX_LINE_BYTES } from "@/server/host/bridge";

/** A bridge wired to in-memory streams, plus helpers to play the shell's side. */
function harness() {
  const toServer = new PassThrough();
  const fromServer = new PassThrough();
  const bridge = new Bridge(toServer, fromServer);
  const sent: unknown[] = [];
  let buf = "";
  fromServer.on("data", (chunk: Buffer) => {
    buf += chunk.toString("utf8");
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      expect(line.startsWith(LINE_PREFIX)).toBe(true);
      sent.push(JSON.parse(line.slice(LINE_PREFIX.length)));
      buf = buf.slice(nl + 1);
    }
  });
  const shell = (msg: unknown) => toServer.write(`${JSON.stringify(msg)}\n`);
  const tick = () => new Promise((r) => setTimeout(r, 5));
  const hello = { secret: "s".repeat(43), port: 51000, dataDir: "/d", logDir: "/l", appVersion: "0.2.0", platform: "macos", arch: "aarch64" };
  return { bridge, sent, shell, tick, hello };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("host bridge (contracts/host-bridge.md)", () => {
  it("ignores everything before hello, then answers hello", async () => {
    const h = harness();
    h.shell({ v: 1, id: "x1", type: "shutdown", params: { reason: "quit" } });
    await h.tick();
    expect(h.sent).toEqual([]);
    h.shell({ v: 1, id: "h1", type: "hello", params: h.hello });
    const hello = await h.bridge.hello;
    expect(hello.port).toBe(51000);
    await h.tick();
    expect(h.sent).toEqual([{ v: 1, re: "h1", ok: true, result: { ok: true } }]);
  });

  it("matches responses to requests by id", async () => {
    const h = harness();
    h.shell({ v: 1, id: "h1", type: "hello", params: h.hello });
    await h.bridge.hello;
    const p = h.bridge.request("credentials.get", { name: "anthropic-api-key", reveal: false }, 1000);
    await h.tick();
    const req = h.sent.find((m) => (m as { type?: string }).type === "credentials.get") as { id: string };
    expect(req).toMatchObject({ v: 1, type: "credentials.get", params: { name: "anthropic-api-key", reveal: false } });
    h.shell({ v: 1, re: req.id, ok: true, result: { present: true } });
    await expect(p).resolves.toEqual({ present: true });
  });

  it("rejects with the shell's error code", async () => {
    const h = harness();
    h.shell({ v: 1, id: "h1", type: "hello", params: h.hello });
    await h.bridge.hello;
    const p = h.bridge.request("shell.reveal", { path: "/etc" }, 1000);
    await h.tick();
    const req = h.sent.at(-1) as { id: string };
    h.shell({ v: 1, re: req.id, ok: false, error: { code: "forbidden", message: "no" } });
    await expect(p).rejects.toMatchObject({ code: "forbidden" });
  });

  it("times out a request with no response", async () => {
    const h = harness();
    h.shell({ v: 1, id: "h1", type: "hello", params: h.hello });
    await h.bridge.hello;
    const p = h.bridge.request("window.focus", undefined, 20);
    await expect(p).rejects.toBeInstanceOf(BridgeError);
    await expect(p).rejects.toMatchObject({ code: "timeout" });
  });

  it("emits events with the v1 envelope", async () => {
    const h = harness();
    h.bridge.emit("ready", { port: 1, schemaLevel: "0012_desktop" });
    await h.tick();
    expect(h.sent).toEqual([{ v: 1, event: "ready", data: { port: 1, schemaLevel: "0012_desktop" } }]);
  });

  it("dispatches shell requests to registered handlers", async () => {
    const h = harness();
    const handler = vi.fn(async () => ({ ok: true }));
    h.bridge.onRequest("shutdown", handler);
    h.shell({ v: 1, id: "h1", type: "hello", params: h.hello });
    await h.bridge.hello;
    h.shell({ v: 1, id: "s1", type: "shutdown", params: { reason: "quit" } });
    await h.tick();
    expect(handler).toHaveBeenCalledWith({ reason: "quit" });
    expect(h.sent.at(-1)).toEqual({ v: 1, re: "s1", ok: true, result: { ok: true } });
  });

  it("answers unknown request types with unsupported", async () => {
    const h = harness();
    h.shell({ v: 1, id: "h1", type: "hello", params: h.hello });
    await h.bridge.hello;
    h.shell({ v: 1, id: "u1", type: "nope" });
    await h.tick();
    expect(h.sent.at(-1)).toMatchObject({ v: 1, re: "u1", ok: false, error: { code: "unsupported" } });
  });

  it("drops lines over the size limit and malformed lines without crashing", async () => {
    const h = harness();
    const onError = vi.fn();
    h.bridge.on("protocol-error", onError);
    h.shell({ v: 1, id: "h1", type: "hello", params: h.hello });
    await h.bridge.hello;
    h.shell({ v: 1, id: "big", type: "x", params: "a".repeat(MAX_LINE_BYTES + 1) });
    h.shell("not json");
    h.shell({ v: 2, id: "old", type: "x" });
    await h.tick();
    expect(onError).toHaveBeenCalledTimes(3);
    // Still alive afterwards.
    h.bridge.emit("ready", {});
    await h.tick();
    expect(h.sent.at(-1)).toEqual({ v: 1, event: "ready", data: {} });
  });
});

describe("web-mode fallbacks", () => {
  it("credentials come from the environment and can't be changed", async () => {
    vi.stubEnv("FARABI_HOST", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-key-1234567890");
    const host = await import("@/server/host/bridge");
    expect(host.isDesktop()).toBe(false);
    await expect(host.getCredential({ reveal: true })).resolves.toEqual({ present: true, value: "sk-test-key-1234567890" });
    await expect(host.getCredential({ reveal: false })).resolves.toEqual({ present: true });
    await expect(host.setCredential("x".repeat(30))).rejects.toMatchObject({ code: "unsupported" });
    await expect(host.deleteCredential()).rejects.toMatchObject({ code: "unsupported" });
    await expect(host.pickFolder({ title: "x" })).rejects.toMatchObject({ code: "unsupported" });
    await expect(host.reveal("/tmp")).resolves.toBeUndefined();
    vi.unstubAllEnvs();
  });
});
