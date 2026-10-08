// Finding Claude Code without the shell's PATH (feature 11, research R8).
import { describe, expect, it } from "vitest";
import {
  claudeCodeStatus,
  discoverClaudeCode,
  type DiscoveryDeps,
  isAuthError,
  noteClaudeCodeRun,
  quoteForCmd,
  resetClaudeCodeStatus,
  spawnSpec,
} from "@/server/ai/claudeCodeDiscovery";
import { childEnv } from "@/server/ai/claudeCode";

function deps(over: Partial<DiscoveryDeps> & { files?: string[]; calls?: string[][] } = {}): DiscoveryDeps {
  const files = new Set(over.files ?? []);
  const calls = over.calls ?? [];
  return {
    platform: over.platform ?? "darwin",
    env: over.env ?? ({ SHELL: "/bin/zsh" }),
    home: over.home ?? "/Users/me",
    exists: (p) => files.has(p),
    run: over.run ?? (async (cmd, args) => (calls.push([cmd, ...args]), { code: 1, stdout: "" })),
    configured: over.configured ?? null,
    allowPathLookup: over.allowPathLookup ?? false,
  };
}

describe("discoverClaudeCode on macOS", () => {
  it("prefers the configured path", async () => {
    expect(await discoverClaudeCode(deps({ configured: "/opt/claude", files: ["/opt/claude", "/usr/local/bin/claude"] }))).toBe("/opt/claude");
    expect(await discoverClaudeCode(deps({ configured: "/missing" }))).toBeNull();
  });

  it("asks the login shell before the fixed locations", async () => {
    const calls: string[][] = [];
    const run: DiscoveryDeps["run"] = async (cmd, args) => (calls.push([cmd, ...args]), { code: 0, stdout: "Welcome!\n/Users/me/bin/claude\n" });
    const found = await discoverClaudeCode(deps({ run, files: ["/Users/me/bin/claude", "/opt/homebrew/bin/claude"] }));
    expect(found).toBe("/Users/me/bin/claude");
    expect(calls[0]).toEqual(["/bin/zsh", "-ilc", "command -v claude"]);
  });

  it("tries the fixed locations in order", async () => {
    const order = ["/Users/me/.claude/local/claude", "/Users/me/.local/bin/claude", "/opt/homebrew/bin/claude", "/usr/local/bin/claude"];
    for (let i = 0; i < order.length; i++) {
      expect(await discoverClaudeCode(deps({ files: order.slice(i) }))).toBe(order[i]);
    }
    expect(await discoverClaudeCode(deps())).toBeNull();
    // The web app keeps its old behavior: `claude` on PATH.
    expect(await discoverClaudeCode(deps({ allowPathLookup: true }))).toBe("claude");
  });
});

describe("discoverClaudeCode on Windows", () => {
  const env = { USERPROFILE: "C:\\Users\\me", APPDATA: "C:\\Users\\me\\AppData\\Roaming" };
  it("tries the native install, the npm shim, then `where`", async () => {
    const exe = "C:\\Users\\me\\.local\\bin\\claude.exe";
    const shim = "C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd";
    expect(await discoverClaudeCode(deps({ platform: "win32", env, files: [exe, shim] }))).toBe(exe);
    expect(await discoverClaudeCode(deps({ platform: "win32", env, files: [shim] }))).toBe(shim);
    const run: DiscoveryDeps["run"] = async (cmd) => (cmd === "where" ? { code: 0, stdout: "D:\\tools\\claude.exe\r\n" } : { code: 1, stdout: "" });
    expect(await discoverClaudeCode(deps({ platform: "win32", env, run, files: ["D:\\tools\\claude.exe"] }))).toBe("D:\\tools\\claude.exe");
  });

  it("runs .cmd shims through cmd.exe with every argument quoted", () => {
    const spec = spawnSpec("C:\\npm\\claude.cmd", ["-p", "--system-prompt", 'say "hi" & 100%'], "win32");
    expect(spec.command).toBe("cmd.exe");
    expect(spec.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(spec.args[3]).toBe(`""C:\\npm\\claude.cmd" "-p" "--system-prompt" "say ""hi"" ^& 100^%""`);
    expect(spec.windowsVerbatimArguments).toBe(true);
    expect(quoteForCmd("a|b")).toBe('"a^|b"');
    expect(spawnSpec("C:\\x\\claude.exe", ["-p"], "win32")).toEqual({ command: "C:\\x\\claude.exe", args: ["-p"] });
  });
});

describe("status probe", () => {
  it("maps a failing --version to not_found, and an auth error to signed_out", async () => {
    resetClaudeCodeStatus();
    noteClaudeCodeRun("ok");
    const failing = deps({ configured: "/c/claude", files: ["/c/claude"], run: async () => ({ code: 1, stdout: "" }) });
    expect((await claudeCodeStatus({ refresh: true, deps: failing })).status).toBe("not_found");

    const working = deps({ configured: "/c/claude", files: ["/c/claude"], run: async () => ({ code: 0, stdout: "2.1.283 (Claude Code)\n" }) });
    expect(await claudeCodeStatus({ refresh: true, deps: working })).toMatchObject({ status: "found", path: "/c/claude", version: "2.1.283" });
    expect(isAuthError("Invalid API key · Please run /login")).toBe(true);
    noteClaudeCodeRun("auth_error");
    expect((await claudeCodeStatus({ deps: working })).status).toBe("signed_out");
    noteClaudeCodeRun("ok");
    expect((await claudeCodeStatus({ deps: working })).status).toBe("found");
  });

  it("still strips API credentials and the parent session from the child's environment", () => {
    const env = childEnv({ NODE_ENV: "test", ANTHROPIC_API_KEY: "k", ANTHROPIC_AUTH_TOKEN: "t", CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "x", PATH: "/bin" });
    expect(env).toEqual({ NODE_ENV: "test", PATH: "/bin" });
  });
});
