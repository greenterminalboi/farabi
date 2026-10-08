// `npm run feedback:addressed` against a closed desktop store (feature 11, contracts/cli.md): the
// output and exit codes Claude Code relies on are unchanged (FR-020). With the app open, the same
// script goes through the app (tests/e2e/f3-us4-resolve.spec.ts).
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "farabi-cli-"));
const exportDir = mkdtempSync(path.join(os.tmpdir(), "farabi-cli-export-"));
process.env.FARABI_HOST = "tauri";
process.env.FARABI_DATA_DIR = dataDir;

const { db, closeDb } = await import("@/server/db/client");
const { prepareStore } = await import("@/server/db/startup");
const { loadConfig, setConfig } = await import("@/server/settings/config");

const root = path.resolve(import.meta.dirname, "../..");
const run = promisify(execFile);

async function script(...args: string[]): Promise<{ code: number; stdout: string }> {
  try {
    const { stdout } = await run("npx", ["tsx", "scripts/feedback-addressed.ts", ...args, "--data-dir", dataDir], { cwd: root });
    return { code: 0, stdout };
  } catch (err) {
    const e = err as { code: number; stdout: string };
    return { code: e.code, stdout: e.stdout };
  }
}

describe("feedback:addressed on a closed store", () => {
  let id: string;
  beforeAll(async () => {
    await prepareStore();
    await loadConfig();
    await setConfig("feedback_export_dir", exportDir);
    id = crypto.randomUUID();
    await db.insertInto("feedback_items").values({ id, text: "Script me", view: "map", provenance: "user_authored" }).execute();
    await db.insertInto("feedback_state_events").values({ item_id: id, state: "open", provenance: "user_authored" }).execute();
    // The script opens the store itself, so this process lets go of it.
    await closeDb();
  });
  afterAll(async () => {
    await closeDb();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(exportDir, { recursive: true, force: true });
  });

  it("exits 0, 2, 3 and 1 as documented, and changes only the state", async () => {
    const first = await script(id);
    expect(first.code).toBe(0);
    expect(first.stdout).toContain(`Marked ${id} addressed.`);
    const again = await script(id);
    expect(again.code).toBe(2);
    expect(again.stdout).toContain("is addressed; only open items can be marked addressed. No change.");
    expect((await script(crypto.randomUUID())).code).toBe(3);
    expect((await script("not-a-uuid")).code).toBe(1);
    expect((await script(id, "--state=resolved")).code).toBe(1);

    const events = await db.selectFrom("feedback_state_events").select("state").where("item_id", "=", id).orderBy("created_at").execute();
    expect(events.map((e) => e.state)).toEqual(["open", "addressed"]);
    expect(readFileSync(path.join(exportDir, "FEEDBACK.md"), "utf8")).toMatch(/0 open · 1 addressed · 0 resolved/);
  }, 120_000);
});
