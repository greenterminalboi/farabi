import Anthropic from "@anthropic-ai/sdk";
import { buildReplyRequest, buildSummaryRequest, cleanSummary } from "./claudePrompts";
import { AIUnavailableError, type AIProvider, type ReplyInput, type SummaryInput } from "./provider";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5";
// Server-side refusal fallback: a declined request is re-run on Anthropic's recommended model.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Maps SDK failures to AIUnavailableError where the right response is "try again later"
 * (network, rate limit, overload, server errors, bad credentials). Anything else is a bug in
 * the request and is re-thrown as is.
 */
function toProviderError(err: unknown): unknown {
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

export class ClaudeProvider implements AIProvider {
  private client: Anthropic | undefined;

  /** Created on first use. Reads ANTHROPIC_API_KEY from the server environment (.env.local). */
  private getClient(): Anthropic {
    this.client ??= new Anthropic();
    return this.client;
  }

  async reply(input: ReplyInput): Promise<string> {
    const { system, messages } = buildReplyRequest(input);
    try {
      // Streamed so long answers don't hit HTTP timeouts; the app stores the finished reply.
      const stream = this.getClient().beta.messages.stream(
        {
          model: MODEL,
          max_tokens: 64000,
          betas: [FALLBACK_BETA],
          fallbacks: "default",
          cache_control: { type: "ephemeral" },
          system,
          messages,
        },
        { signal: input.signal },
      );
      const text = textOf(await stream.finalMessage());
      if (!text) throw new AIUnavailableError("Claude returned an empty reply");
      return text;
    } catch (err) {
      throw toProviderError(err);
    }
  }

  async summarize(input: SummaryInput): Promise<string> {
    const { system, messages } = buildSummaryRequest(input);
    try {
      const message = await this.getClient().beta.messages.create(
        {
          model: MODEL,
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
}
