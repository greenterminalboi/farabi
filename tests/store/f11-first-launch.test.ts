// First launch on an empty data folder (feature 11, US1, T033): the server's whole start-up, with
// this test playing the shell on the other end of the stdio bridge.
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "farabi-first-"));
delete process.env.DATABASE_URL;
delete process.env.AI_PROVIDER;
process.env.FARABI_HOST = "tauri";
process.env.FARABI_DATA_DIR = dataDir;

const { LINE_PREFIX } = await import("@/server/host/bridge");
const { desktopStartup, shutdown } = await import("@/server/db/startup");
const { db } = await import("@/server/db/client");
const { MIGRATIONS } = await import("@/server/db/migrationList");
const { resolveConfig } = await import("@/server/settings/config");

const toServer = new PassThrough();
const fromServer = new PassThrough();
const events: Array<{ event: string; data: Record<string, unknown> }> = [];
let buffer = "";
fromServer.on("data", (chunk: Buffer) => {
  buffer += chunk.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.startsWith(LINE_PREFIX)) continue;
    const msg = JSON.parse(line.slice(LINE_PREFIX.length));
    if (msg.event) events.push(msg);
  }
});

const SECRET = "Q".repeat(43);
const until = async (pred: () => boolean, ms = 30000) => {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe("first launch on an empty data folder", () => {
  beforeAll(async () => {
    const started = desktopStartup({ stdin: toServer, stdout: fromServer });
    toServer.write(
      `${JSON.stringify({ v: 1, id: "h1", type: "hello", params: { secret: SECRET, port: 51999, dataDir, logDir: dataDir, appVersion: "0.2.0", platform: "macos", arch: "aarch64" } })}\n`,
    );
    await started;
    await until(() => events.some((e) => ["ready", "blocked", "fatal"].includes(e.event)));
  });
  afterAll(async () => {
    await shutdown(dataDir);
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("creates the store and says it is ready", () => {
    expect(events.map((e) => e.event)).toEqual(["ready"]);
    expect(events[0].data).toEqual({ port: 51999, schemaLevel: Object.keys(MIGRATIONS).sort().at(-1) });
    expect(existsSync(path.join(dataDir, "store", "PG_VERSION"))).toBe(true);
    // A new store has nothing to back up.
    expect(existsSync(path.join(dataDir, "backups"))).toBe(false);
  });

  it("runs every migration", async () => {
    const { rows } = await sql<{ name: string }>`SELECT name FROM kysely_migration ORDER BY name`.execute(db);
    expect(rows.map((r) => r.name)).toEqual(Object.keys(MIGRATIONS).sort());
  });

  it("writes runtime.json with the data-model §5 shape, readable only by the owner", () => {
    const file = path.join(dataDir, "runtime.json");
    const runtime = JSON.parse(readFileSync(file, "utf8"));
    expect(runtime).toEqual({
      pid: process.pid,
      port: 51999,
      secret: SECRET,
      startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      appVersion: "0.2.0",
      schemaLevel: Object.keys(MIGRATIONS).sort().at(-1),
      store: "pglite",
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("uses the fake provider until one is chosen, and no export folder", () => {
    expect(resolveConfig("ai_provider")).toEqual({ value: "fake", source: "default", changedAt: null });
    expect(resolveConfig("feedback_export_dir").value).toBeNull();
  });

  it("creates the default project on the first project list, as the web app does", async () => {
    const { GET } = await import("@/app/api/projects/route");
    const res = await GET(new Request("http://127.0.0.1:51999/api/projects", { headers: { host: "127.0.0.1:51999" } }), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projects: unknown[] };
    expect(body.projects).toHaveLength(1);
  });

  it("removes runtime.json and the lock on shutdown", async () => {
    await shutdown(dataDir);
    expect(existsSync(path.join(dataDir, "runtime.json"))).toBe(false);
    expect(existsSync(path.join(dataDir, "store.lock"))).toBe(false);
    expect(existsSync(path.join(dataDir, "store-schema.json"))).toBe(true);
  });
});
