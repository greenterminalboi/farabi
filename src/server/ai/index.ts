import { ClaudeProvider, defaultClaudeModel } from "./claude";
import { ClaudeCodeProvider } from "./claudeCode";
import { FakeAIProvider } from "./fake";
import type { ReplyModelChoice } from "@/shared/models";
import type { AIProvider } from "./provider";

import { defaultModelFor, getConfig } from "../settings/config";
import { getCredential } from "../host/bridge";
import { claudeCodeStatus } from "./claudeCodeDiscovery";
import type { ProviderNotReadyReason } from "@/shared/desktop";

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

/** The chosen provider can't run yet; the route answers 422 before writing anything (FR-014). */
export class ProviderNotReadyError extends Error {
  readonly code = "provider_not_ready";
  readonly settingsPath = "/settings#provider";
  constructor(
    readonly provider: "claude" | "claude-code",
    readonly reason: ProviderNotReadyReason,
  ) {
    super(
      reason === "no_api_key"
        ? "Add your Claude API key in Settings to use the Claude API."
        : reason === "claude_code_not_found"
          ? "Claude Code wasn't found on this computer. Choose its location in Settings, or pick another provider."
          : "Claude Code isn't signed in. Run `claude` in a terminal and sign in, then try again.",
    );
  }
}

/**
 * Throws ProviderNotReadyError when the provider in effect can't run: no API key for `claude`, or
 * Claude Code missing or signed out. Called at the start of every route that starts AI work.
 */
export async function providerReady(): Promise<void> {
  const kind = getConfig("ai_provider");
  if (kind === "claude") {
    const { present } = await getCredential({ reveal: false });
    if (!present) throw new ProviderNotReadyError("claude", "no_api_key");
  } else if (kind === "claude-code") {
    const { status } = await claudeCodeStatus();
    if (status === "not_found") throw new ProviderNotReadyError("claude-code", "claude_code_not_found");
    if (status === "signed_out") throw new ProviderNotReadyError("claude-code", "claude_code_signed_out");
  }
}

export { AIUnavailableError } from "./provider";
