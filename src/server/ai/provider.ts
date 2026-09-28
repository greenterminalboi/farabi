// Boundary defined in specs/001-branching-chat-map/contracts/ai-provider.md

export interface ChatTurn {
  role: "user" | "ai";
  content: string;
}

export interface ReplyInput {
  /** Ancestor messages up to each branch point, oldest first (FR-005). Empty for roots. */
  inheritedContext: ChatTurn[];
  /** The exact anchor text for a branch; null for roots (FR-004). */
  anchorText: string | null;
  /** This node's own non-replaced messages, ending with the latest user message. */
  messages: ChatTurn[];
  /** Information pressure level for this reply; null means no length guidance (Feature 6). */
  pressureLevel: number | null;
  /** Model id for this reply; null means the setup's configured default (Feature 6). */
  model: string | null;
  signal?: AbortSignal;
}

export interface SummaryInput {
  /** Anchor text for a branch; null for roots. */
  anchorText: string | null;
  /** This node's own non-replaced messages only — never inherited context (FR-012). */
  messages: ChatTurn[];
  signal?: AbortSignal;
}

export interface DefineInput {
  term: string;
  /** The message the term was captured from. */
  sourceMessage: ChatTurn;
  /** The source node's own messages; never inherited context (Feature 2, FR-029). */
  messages: ChatTurn[];
  signal?: AbortSignal;
}

/** A short two-part definition: general meaning, then how the source conversation uses it. */
export interface DefinitionText {
  general: string;
  usage: string;
}

export interface ReplyOptions {
  /** Called with each new piece of text as it is generated (Feature 2 streaming). */
  onText?: (delta: string) => void;
}

export interface AIProvider {
  /**
   * Resolves to the full reply text. Throws AIUnavailableError when nothing was generated,
   * AIPartialReplyError when it failed after some text, or an AbortError when input.signal aborts.
   */
  reply(input: ReplyInput, options?: ReplyOptions): Promise<string>;
  /** Resolves to exactly one sentence. Throws AIUnavailableError on failure. */
  summarize(input: SummaryInput): Promise<string>;
  /** Drafts a short two-part definition (Feature 2, FR-029). Throws AIUnavailableError on failure. */
  define(input: DefineInput): Promise<DefinitionText>;
}

export class AIUnavailableError extends Error {}

/** Generation failed after some text was delivered through onText; carries that text. */
export class AIPartialReplyError extends AIUnavailableError {
  constructor(
    readonly partial: string,
    message = "The reply was cut off",
  ) {
    super(message);
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export function abortError(): Error {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}
