import { ClaudeProvider, defaultClaudeModel } from "./claude";
import { ClaudeCodeProvider } from "./claudeCode";
import { FakeAIProvider } from "./fake";
import type { ReplyModelChoice } from "@/shared/models";
import type { AIProvider } from "./provider";

import { defaultModelFor, getConfig } from "../settings/config";

const providers = new Map<string, AIProvider>();

/**
 * The provider in effect, from the `ai_provider` setting (feature 11), which falls back to
 * `AI_PROVIDER` in the web app and tests:
 * - `claude-code`: the local Claude Code CLI, using your Claude subscription (personal use)
 * - `claude`: the Claude API, billed to your API key
 * - `fake` (default): deterministic output for development and tests
 */
export function getAIProvider(): AIProvider {
  const kind = getConfig("ai_provider");
  let provider = providers.get(kind);
  if (!provider) {
    if (kind === "claude-code") provider = new ClaudeCodeProvider();
    else if (kind === "claude") provider = new ClaudeProvider();
    else if (kind === "fake") provider = new FakeAIProvider();
    else throw new Error(`Unknown AI provider "${kind}" (expected "claude-code", "claude" or "fake")`);
    providers.set(kind, provider);
  }
  return provider;
}

/**
 * The model a reply will use for a choice (Feature 6, research R4), or null when the setup's default
 * isn't known ahead of time (the Claude Code CLI's own default, or the fake provider).
 */
export function resolveReplyModel(choice: ReplyModelChoice): string | null {
  if (choice !== "default") return choice;
  const kind = getConfig("ai_provider");
  if (kind === "claude") return defaultClaudeModel();
  if (kind === "claude-code") return defaultModelFor("claude-code");
  return null;
}

export { AIUnavailableError } from "./provider";
