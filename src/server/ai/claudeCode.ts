// Runs Claude through the local Claude Code CLI in headless mode (`claude -p`), so replies use
// the user's own Claude subscription instead of API billing. Personal, local use only.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildHeadlessReply, buildHeadlessSummary, cleanSummary } from "./claudePrompts";
import { AIUnavailableError, type AIProvider, type ReplyInput, type SummaryInput } from "./provider";

const CLAUDE_BIN = process.env.CLAUDE_CODE_BIN ?? "claude";
const TIMEOUT_MS = Number(process.env.CLAUDE_CODE_TIMEOUT_MS ?? 180_000);
// An empty working directory, so no project CLAUDE.md or settings shape the replies.
const WORKDIR = mkdtempSync(path.join(tmpdir(), "farabi-claude-"));

type HeadlessResult = { type: string; subtype?: string; is_error?: boolean; result?: string };

/** Environment for the child: no API credentials (so it can't bill an API key) and no parent session. */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === "ANTHROPIC_API_KEY" || key === "ANTHROPIC_AUTH_TOKEN" || key === "CLAUDECODE" || key.startsWith("CLAUDE_CODE_")) {
      delete env[key];
    }
  }
  return env;
}

function runHeadless(system: string, prompt: string, options: { effort?: string; signal?: AbortSignal }): Promise<string> {
  const args = [
    "-p",
    "--output-format", "json",
    "--system-prompt", system,
    "--tools", "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-session-persistence",
  ];
  if (process.env.CLAUDE_CODE_MODEL) args.push("--model", process.env.CLAUDE_CODE_MODEL);
  if (options.effort) args.push("--effort", options.effort);

  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, { cwd: WORKDIR, env: childEnv(), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const fail = (message: string) => reject(new AIUnavailableError(message));

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      fail(`Claude Code didn't answer within ${Math.round(TIMEOUT_MS / 1000)} s`);
    }, TIMEOUT_MS);
    const onAbort = () => {
      child.kill("SIGTERM");
      fail("Request cancelled");
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (d: Buffer) => (stdout += d));
    child.stderr.on("data", (d: Buffer) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      console.error("Couldn't start Claude Code. Is the `claude` CLI installed and logged in?", err);
      fail("Claude Code is not available");
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      let parsed: HeadlessResult | undefined;
      try {
        parsed = JSON.parse(stdout) as HeadlessResult;
      } catch {
        // fall through to the error below
      }
      if (code === 0 && parsed && !parsed.is_error && parsed.subtype === "success" && parsed.result?.trim()) {
        resolve(parsed.result.trim());
        return;
      }
      // Usage limits, auth problems and outages all land here; the app offers a retry.
      const detail = parsed?.result ?? stderr.trim().split("\n").at(-1) ?? `exit code ${code}`;
      console.error("Claude Code call failed:", detail);
      fail(`Claude Code call failed: ${detail}`);
    });

    child.stdin.end(prompt);
  });
}

export class ClaudeCodeProvider implements AIProvider {
  async reply(input: ReplyInput): Promise<string> {
    const { system, prompt } = buildHeadlessReply(input);
    return runHeadless(system, prompt, { signal: input.signal });
  }

  async summarize(input: SummaryInput): Promise<string> {
    const { system, prompt } = buildHeadlessSummary(input);
    const summary = cleanSummary(await runHeadless(system, prompt, { effort: "low", signal: input.signal }));
    if (!summary) throw new AIUnavailableError("Claude Code returned an empty summary");
    return summary;
  }
}
