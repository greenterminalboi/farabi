// Which data a repo script works on (feature 11, contracts/cli.md).
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultDataDir, resolveTarget, scriptArgs, withTarget, type ResolveDeps } from "../../scripts/env";

const DIR = path.resolve("/tmp/farabi-data");
const runtime = (pid: number) => JSON.stringify({ pid, port: 51873, secret: "s".repeat(43) });

function deps(over: Partial<ResolveDeps> & { files?: Record<string, string> } = {}): ResolveDeps {
  const files = over.files ?? {};
  return {
    argv: over.argv ?? [],
    env: over.env ?? { FARABI_DATA_DIR: DIR },
    pidAlive: over.pidAlive ?? ((pid) => pid === 4242),
    readFile: (p) => files[p] ?? null,
  };
}

describe("resolveTarget", () => {
  it("ignores DATABASE_URL: there is no Postgres store since the cut-over", () => {
    expect(resolveTarget(deps({ env: { DATABASE_URL: "postgres://x/y", FARABI_DATA_DIR: DIR } }))).toEqual({ kind: "closed", dataDir: DIR });
  });

  it("uses the running app when runtime.json names a live process", () => {
    const t = resolveTarget(deps({ files: { [path.join(DIR, "runtime.json")]: runtime(4242) } }));
    expect(t).toMatchObject({ kind: "live", dataDir: DIR, baseUrl: "http://127.0.0.1:51873", pid: 4242 });
  });

  it("opens the store directly when runtime.json is stale, torn or missing", () => {
    expect(resolveTarget(deps({ files: { [path.join(DIR, "runtime.json")]: runtime(1) } }))).toEqual({ kind: "closed", dataDir: DIR });
    expect(resolveTarget(deps({ files: { [path.join(DIR, "runtime.json")]: "{ torn" } }))).toEqual({ kind: "closed", dataDir: DIR });
    expect(resolveTarget(deps())).toEqual({ kind: "closed", dataDir: DIR });
  });

  it("lets --data-dir override FARABI_DATA_DIR", () => {
    const other = path.resolve("/tmp/other");
    expect(resolveTarget(deps({ argv: ["x", "--data-dir", other], env: { DATABASE_URL: "postgres://x/y", FARABI_DATA_DIR: DIR } }))).toEqual({ kind: "closed", dataDir: other });
    expect(scriptArgs(["--data-dir", other, "abc"])).toEqual(["abc"]);
  });

  it("falls back to the platform's app data folder", () => {
    expect(defaultDataDir("darwin", {}, "/Users/me")).toBe("/Users/me/Library/Application Support/app.farabi");
    expect(defaultDataDir("win32", { APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, "C:\\Users\\me")).toContain("app.farabi");
  });
});

describe("withTarget", () => {
  it("exits 2 for a refusing script while the app is running", async () => {
    let ran = false;
    const code = await withTarget({
      target: { kind: "live", dataDir: DIR, baseUrl: "http://127.0.0.1:1", secret: "s", pid: 4242 },
      refuseWhenLive: "Quit Farabi first; it migrates its own data on start.",
      store: async () => ((ran = true), 0),
    });
    expect(code).toBe(2);
    expect(ran).toBe(false);
  });

  it("uses the live branch when there is one", async () => {
    const code = await withTarget({
      target: { kind: "live", dataDir: DIR, baseUrl: "http://127.0.0.1:1", secret: "s", pid: 4242 },
      live: async () => 0,
      store: async () => 1,
    });
    expect(code).toBe(0);
  });
});
