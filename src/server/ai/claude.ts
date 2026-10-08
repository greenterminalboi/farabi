import Anthropic from "@anthropic-ai/sdk";
import {
  buildDefineRequest,
  buildReplyRequest,
  buildSummaryRequest,
  cleanSummary,
  parseDefinition,
} from "./claudePrompts";
import {
  AIPartialReplyError,
  AIUnavailableError,
  isAbortError,
  type AIProvider,
  type CompletionInput,
  type DefineInput,
  type DefinitionText,
  type ReplyInput,
  type ReplyOptions,
  type SummaryInput,
} from "./provider";
import { getBridge, getCredential, isDesktop } from "../host/bridge";
import { registerSecret } from "../host/redact";
import { defaultModelFor } from "../settings/config";

/** The default model: the `default_model` setting (feature 11; CLAUDE_MODEL in the web app), else claude-opus-5. */
export function defaultClaudeModel(): string {
  return defaultModelFor("claude") ?? "claude-opus-5";
}
// Server-side refusal fallback: a declined request is re-run on Anthropic's recommended model.
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
// Models documented to accept `fallbacks` (Feature 6, research R2); others are sent without it.
const FALLBACK_MODELS = new Set(["claude-opus-5", "claude-opus-5-5", "claude-fable-5-1"]);

/**
 * Maps SDK failures to AIUnavailableError where the right response is "try again later"
 * (network, rate limit, overload, server errors, bad credentials). Anything else is a bug in
 * the request and is re-thrown as is.
 */
function toProviderError(err: unknown, model?: string): unknown {
  // A reply model the user chose that the API can't serve (Feature 6, US4 AS5).
  if (
    model &&
    (err instanceof Anthropic.NotFoundError || (err instanceof Anthropic.BadRequestError && /model/i.test(err.message)))
  ) {
    return new AIUnavailableError(`The chosen model (${model}) isn't available`);
  }
  if (err instanceof Anthropic.APIConnectionError) return new AIUnavailableError(`Can't reach Claude: ${err.message}`);
  if (err instanceof Anthropic.RateLimitError) return new AIUnavailableError("Claude rate limit reached");
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    console.error("Claude API credentials were rejected. Check ANTHROPIC_API_KEY in .env.local.");
    return new AIUnavailableError("Claude API credentials were rejected");
  }
  if (err instanceof Anthropic.APIError && typeof err.status === "number" && err.status >= 500) {
    return new AIUnavailableError(`Claude is unavailable (${err.status})`);
  }
  if (err instanceof Anthropic.AnthropicError && !(err instanceof Anthropic.APIError)) {
    // Raised before any request is sent, e.g. no credentials configured.
    console.error("Claude API client error. Is ANTHROPIC_API_KEY set in .env.local?", err.message);
    return new AIUnavailableError("Claude API is not configured");
  }
  return err;
}

function textOf(message: Anthropic.Beta.BetaMessage): string {
  if (message.stop_reason === "refusal") {
    // Even the fallback model declined.
    throw new AIUnavailableError(`Claude declined to answer (${message.stop_details?.category ?? "unspecified"})`);
  }
  if (message.stop_reason === "max_tokens") console.warn("Claude reply hit max_tokens and was cut off");
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/** The streaming request body for a reply: the chosen model, with fallbacks where supported. */
export function replyParams(input: ReplyInput) {
  const { system, messages } = buildReplyRequest(input);
  const model = input.model ?? defaultClaudeModel();
  return {
    model,
    max_tokens: 64000,
    ...(FALLBACK_MODELS.has(model) ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
    cache_control: { type: "ephemeral" as const },
    system,
    messages,
  };
}

export class ClaudeProvider implements AIProvider {
  private client: Anthropic | undefined;

  private listening = false;

  /**
   * Created on first use. The key comes from the OS credential store in the desktop app (feature
   * 11, FR-013) and from ANTHROPIC_API_KEY in the web app. It's kept in memory only and never logged.
   */
  private async getClient(): Promise<Anthropic> {
    if (this.client) return this.client;
    const { value } = await getCredential({ reveal: true });
    registerSecret(value);
    if (isDesktop() && !this.listening) {
      this.listening = true;
      // A key saved or removed in Settings applies to the next request.
      getBridge()?.on("event:credentials.changed", () => (this.client = undefined));
    }
    this.client = new Anthropic(value ? { apiKey: value } : {});
    return this.client;
  }

  /** Drops the client so the next request reads the key again. */
  resetClient(): void {
    this.client = undefined;
  }

  async reply(input: ReplyInput, options?: ReplyOptions): Promise<string> {
    const params = replyParams(input);
    let delivered = "";
    try {
      // Streamed so long answers don't hit HTTP timeouts, and so the app can show text as it comes.
      const stream = (await this.getClient()).beta.messages.stream(params, { signal: input.signal });
      stream.on("text", (delta) => {
        delivered += delta;
        options?.onText?.(delta);
      });
      const text = textOf(await stream.finalMessage());
      if (!text) throw new AIUnavailableError("Claude returned an empty reply");
      return text;
    } catch (err) {
      if (isAbortError(err) || input.signal?.aborted) throw err;
      const mapped = toProviderError(err, params.model);
      if (delivered && mapped instanceof AIUnavailableError && !(mapped instanceof AIPartialReplyError)) {
        throw new AIPartialReplyError(delivered, mapped.message);
      }
      throw mapped;
    }
  }

  async summarize(input: SummaryInput): Promise<string> {
    const { system, messages } = buildSummaryRequest(input);
    try {
      const message = await (await this.getClient()).beta.messages.create(
        {
          model: defaultClaudeModel(),
          max_tokens: 4000,
          betas: [FALLBACK_BETA],
          fallbacks: "default",
          // A one-line label doesn't need deep reasoning.
          output_config: { effort: "low" },
          system,
          messages,
        },
        { signal: input.signal },
      );
      const summary = cleanSummary(textOf(message));
      if (!summary) throw new AIUnavailableError("Claude returned an empty summary");
      return summary;
    } catch (err) {
      throw toProviderError(err);
    }
  }

  async define(input: DefineInput): Promise<DefinitionText> {
    const { system, prompt } = buildDefineRequest(input);
    try {
      const message = await (await this.getClient()).beta.messages.create(
        {
          model: defaultClaudeModel(),
          max_tokens: 4000,
          betas: [FALLBACK_BETA],
          fallbacks: "default",
          output_config: { effort: "low" },
          system,
          messages: [{ role: "user", content: prompt }],
        },
        { signal: input.signal },
      );
      return parseDefinition(textOf(message));
    } catch (err) {
      throw toProviderError(err);
    }
  }

  async complete(input: CompletionInput): Promise<string> {
    const model = input.model ?? defaultClaudeModel();
    try {
      const message = await (await this.getClient()).beta.messages.create(
        {
          model,
          max_tokens: input.maxTokens ?? 4000,
          // A chosen model gets fallbacks only where documented (as replies do); the default always has.
          ...(!input.model || FALLBACK_MODELS.has(model) ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
          output_config: { effort: input.effort ?? "low" },
          system: input.system,
          messages: [{ role: "user", content: input.prompt }],
        },
        { signal: input.signal },
      );
      const text = textOf(message).trim();
      if (!text) throw new AIUnavailableError(`Claude returned an empty ${input.tag}`);
      return text;
    } catch (err) {
      throw toProviderError(err, input.model ?? undefined);
    }
  }
}
