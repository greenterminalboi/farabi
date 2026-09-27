// Runs Claude through the local Claude Code CLI in headless mode (`claude -p`), so replies use
// the user's own Claude subscription instead of API billing. Personal, local use only.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildDefineRequest, buildHeadlessReply, buildHeadlessSummary, cleanSummary, parseDefinition } from "./claudePrompts";
import {
  abortError,
  AIPartialReplyError,
  AIUnavailableError,
  type AIProvider,
  type DefineInput,
  type DefinitionText,
  type ReplyInput,
  type ReplyOptions,
  type SummaryInput,
} from "./provider";

const CLAUDE_BIN = process.env.CLAUDE_CODE_BIN ?? "claude";
const TIMEOUT_MS = Number(process.env.CLAUDE_CODE_TIMEOUT_MS ?? 180_000);
// An empty working directory, so no project CLAUDE.md or settings shape the replies.
const WORKDIR = mkdtempSync(path.join(tmpdir(), "farabi-claude-"));


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

type StreamLine = {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  event?: { type?: string; delta?: { type?: string; text?: string } };
};

/**
 * Runs `claude -p` with streaming JSON output. Text deltas go to onText as they arrive; the final
 * `result` line decides success. Verified against Claude Code 2.1.283 (research R3).
 */
function runHeadless(
  system: string,
  prompt: string,
  options: { effort?: string; signal?: AbortSignal; onText?: (delta: string) => void },
): Promise<string> {
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--system-prompt", system,
    "--tools", "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-session-persistence",
  ];
  if (process.env.CLAUDE_CODE_MODEL) args.push("--model", process.env.CLAUDE_CODE_MODEL);
  if (options.effort) args.push("--effort", options.effort);

  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(abortError());
    const child = spawn(CLAUDE_BIN, args, { cwd: WORKDIR, env: childEnv(), stdio: ["pipe", "pipe", "pipe"] });
    let pending = "";
    let stderr = "";
    let delivered = "";
    let result: StreamLine | undefined;
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const fail = (message: string) =>
      settle(() => reject(delivered ? new AIPartialReplyError(delivered, message) : new AIUnavailableError(message)));

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      fail(`Claude Code didn't finish within ${Math.round(TIMEOUT_MS / 1000)} s`);
    }, TIMEOUT_MS);
    const onAbort = () => {
      child.kill("SIGTERM");
      settle(() => reject(abortError()));
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let parsed: StreamLine;
      try {
        parsed = JSON.parse(line) as StreamLine;
      } catch {
        return;
      }
      if (
        parsed.type === "stream_event" &&
        parsed.event?.type === "content_block_delta" &&
        parsed.event.delta?.type === "text_delta" &&
        parsed.event.delta.text
      ) {
        delivered += parsed.event.delta.text;
        options.onText?.(parsed.event.delta.text);
      } else if (parsed.type === "result") {
        result = parsed;
      }
    };

    child.stdout.on("data", (d: Buffer) => {
      pending += d.toString();
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      lines.forEach(handleLine);
    });
    child.stderr.on("data", (d: Buffer) => (stderr += d));
    child.on("error", (err) => {
      console.error("Couldn't start Claude Code. Is the `claude` CLI installed and logged in?", err);
      fail("Claude Code is not available");
    });
    child.on("close", (code) => {
      handleLine(pending);
      if (code === 0 && result && !result.is_error && result.subtype === "success" && result.result?.trim()) {
        const text = result.result.trim();
        settle(() => resolve(text));
        return;
      }
      // Usage limits, auth problems and outages all land here; the app offers a retry.
      const detail = result?.result ?? stderr.trim().split("\n").at(-1) ?? `exit code ${code}`;
      console.error("Claude Code call failed:", detail);
      fail(`Claude Code call failed: ${detail}`);
    });

    child.stdin.end(prompt);
  });
}

export class ClaudeCodeProvider implements AIProvider {
  async reply(input: ReplyInput, options?: ReplyOptions): Promise<string> {
    const { system, prompt } = buildHeadlessReply(input);
    return runHeadless(system, prompt, { signal: input.signal, onText: options?.onText });
  }

  async summarize(input: SummaryInput): Promise<string> {
    const { system, prompt } = buildHeadlessSummary(input);
    const summary = cleanSummary(await runHeadless(system, prompt, { effort: "low", signal: input.signal }));
    if (!summary) throw new AIUnavailableError("Claude Code returned an empty summary");
    return summary;
  }

  async define(input: DefineInput): Promise<DefinitionText> {
    const { system, prompt } = buildDefineRequest(input);
    return parseDefinition(await runHeadless(system, prompt, { effort: "low", signal: input.signal }));
  }
}
