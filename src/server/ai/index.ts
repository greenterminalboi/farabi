import { ClaudeProvider } from "./claude";
import { ClaudeCodeProvider } from "./claudeCode";
import { FakeAIProvider } from "./fake";
import type { AIProvider } from "./provider";

let provider: AIProvider | undefined;

/**
 * `AI_PROVIDER`:
 * - `claude-code`: the local Claude Code CLI, using your Claude subscription (personal use)
 * - `claude`: the Claude API, billed to ANTHROPIC_API_KEY
 * - `fake` (default): deterministic output for development and tests
 */
export function getAIProvider(): AIProvider {
  if (provider) return provider;
  const kind = process.env.AI_PROVIDER ?? "fake";
  if (kind === "claude-code") provider = new ClaudeCodeProvider();
  else if (kind === "claude") provider = new ClaudeProvider();
  else if (kind === "fake") provider = new FakeAIProvider();
  else throw new Error(`Unknown AI_PROVIDER "${kind}" (expected "claude-code", "claude" or "fake")`);
  return provider;
}

export { AIUnavailableError } from "./provider";
