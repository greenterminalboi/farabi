// Finding the Claude Code CLI without the shell's PATH (feature 11, research R8, FR-012a). Apps
// started from Finder, the Dock or the Start menu don't inherit the login shell's PATH, so the
// usual install locations are tried in a fixed order, and the result is probed and cached.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ClaudeCodeStatus } from "@/shared/desktop";
import { isDesktop } from "../host/bridge";
import { getConfig } from "../settings/config";

export type Run = (command: string, args: string[], timeoutMs: number) => Promise<{ code: number | null; stdout: string }>;

export type DiscoveryDeps = {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  home: string;
  exists: (p: string) => boolean;
  run: Run;
  /** The user's `claude_code_path` setting (or CLAUDE_CODE_BIN in the web app). */
  configured: string | null;
  /** The web app keeps its old behavior: a bare `claude` found on PATH. */
  allowPathLookup: boolean;
};

const LOGIN_SHELL_TIMEOUT_MS = 3000;
const PROBE_TIMEOUT_MS = 10_000;
const CACHE_MS = 60_000;

const run: Run = (command, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(/*turbopackIgnore: true*/ command, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
      const code = err ? (typeof err.code === "number" ? err.code : null) : 0;
      resolve({ code, stdout: String(stdout ?? "") });
    });
  });

export function defaultDeps(): DiscoveryDeps {
  return {
    platform: process.platform,
    env: process.env,
    home: os.homedir(),
    exists: existsSync,
    run,
    configured: getConfig("claude_code_path"),
    allowPathLookup: !isDesktop(),
  };
}

const hasSeparator = (p: string) => p.includes("/") || p.includes("\\");

/** The CLI's path, trying each candidate in research R8's order; null when none exists. */
export async function discoverClaudeCode(deps: DiscoveryDeps): Promise<string | null> {
  const { platform, env, home, exists, configured } = deps;
  if (configured) {
    // A bare command name (CLAUDE_CODE_BIN=claude in a dev .env) is looked up on PATH as before.
    if (!hasSeparator(configured)) return deps.allowPathLookup ? configured : null;
    return exists(configured) ? configured : null;
  }
  if (platform === "win32") {
    const profile = env.USERPROFILE || home;
    const fixed = [path.win32.join(profile, ".local", "bin", "claude.exe")];
    if (env.APPDATA) fixed.push(path.win32.join(env.APPDATA, "npm", "claude.cmd"));
    for (const p of fixed) if (exists(p)) return p;
    const where = await deps.run("where", ["claude"], LOGIN_SHELL_TIMEOUT_MS);
    const found = where.code === 0 ? where.stdout.split(/\r?\n/).map((l) => l.trim()).find((l) => l && exists(l)) : undefined;
    if (found) return found;
  } else {
    const shell = env.SHELL || "/bin/zsh";
    const answer = await deps.run(shell, ["-ilc", "command -v claude"], LOGIN_SHELL_TIMEOUT_MS);
    // Login shells can print banners; the answer is the last line that is an existing path.
    const fromShell = answer.code === 0
      ? answer.stdout.split("\n").map((l) => l.trim()).reverse().find((l) => l.startsWith("/") && exists(l))
      : undefined;
    if (fromShell) return fromShell;
    const fixed = [
      path.posix.join(home, ".claude", "local", "claude"),
      path.posix.join(home, ".local", "bin", "claude"),
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
    ];
    for (const p of fixed) if (exists(p)) return p;
  }
  return deps.allowPathLookup ? "claude" : null;
}

/** Quotes one argument for `cmd.exe /s /c "…"`: doubled quotes, and cmd's metacharacters escaped. */
export function quoteForCmd(arg: string): string {
  return `"${arg.replace(/"/g, '""').replace(/([%^&|<>!])/g, "^$1")}"`;
}

/**
 * How to spawn the CLI. npm's `.cmd` shims can't be spawned directly on Windows, so they run
 * through `cmd.exe /d /s /c` with every argument quoted.
 */
export function spawnSpec(bin: string, args: string[], platform: NodeJS.Platform = process.platform): {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
} {
  if (platform === "win32" && /\.(cmd|bat)$/i.test(bin)) {
    const line = [bin, ...args].map(quoteForCmd).join(" ");
    return { command: "cmd.exe", args: ["/d", "/s", "/c", `"${line}"`], windowsVerbatimArguments: true };
  }
  return { command: bin, args };
}

/** Claude Code's messages when it isn't signed in (stream-json `result`, or stderr). */
export function isAuthError(text: string): boolean {
  return /not logged in|please run \/login|\/login to|invalid api key|authentication_error|oauth token (has )?expired|unauthori[sz]ed/i.test(text);
}

// ── Status, cached ──────────────────────────────────────────────────────────────────────────────

type State = { status: ClaudeCodeStatus | null; at: number; signedOut: boolean };
const g = globalThis as unknown as { __farabiClaudeCode?: State };
const state = () => (g.__farabiClaudeCode ??= { status: null, at: 0, signedOut: false });

/** Called after each real run: an auth failure marks the CLI signed out until a run succeeds. */
export function noteClaudeCodeRun(outcome: "ok" | "auth_error"): void {
  const s = state();
  const signedOut = outcome === "auth_error";
  if (s.signedOut !== signedOut) {
    s.signedOut = signedOut;
    if (s.status && s.status.status !== "not_found") s.status = { ...s.status, status: signedOut ? "signed_out" : "found" };
  }
}

/** Forgets the cached status (a changed path setting, or the Recheck button). */
export function resetClaudeCodeStatus(): void {
  const s = state();
  s.status = null;
  s.at = 0;
}

/** Finds the CLI and runs `--version`. Cached for 60 s unless `refresh`. */
export async function claudeCodeStatus({ refresh = false, deps = defaultDeps() }: { refresh?: boolean; deps?: DiscoveryDeps } = {}): Promise<ClaudeCodeStatus> {
  const s = state();
  if (!refresh && s.status && Date.now() - s.at < CACHE_MS) return s.status;
  const checkedAt = new Date().toISOString();
  const bin = await discoverClaudeCode(deps);
  let status: ClaudeCodeStatus;
  if (!bin) status = { status: "not_found", checkedAt };
  else {
    const spec = spawnSpec(bin, ["--version"], deps.platform);
    const res = await deps.run(spec.command, spec.args, PROBE_TIMEOUT_MS);
    const version = res.stdout.trim().split(/\s+/)[0];
    status = res.code === 0 && version
      ? { status: s.signedOut ? "signed_out" : "found", path: bin, version, checkedAt }
      : { status: "not_found", checkedAt };
  }
  s.status = status;
  s.at = Date.now();
  return status;
}

/** The CLI to run for a reply: the probed path, else the configured or bare name. */
export async function claudeCodeBinary(): Promise<string> {
  const status = await claudeCodeStatus();
  if (status.path) return status.path;
  throw Object.assign(new Error("Claude Code wasn't found. Choose its location in Settings."), { code: "ENOENT" });
}
