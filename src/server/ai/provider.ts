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
  signal?: AbortSignal;
}

export interface SummaryInput {
  /** Anchor text for a branch; null for roots. */
  anchorText: string | null;
  /** This node's own non-replaced messages only — never inherited context (FR-012). */
  messages: ChatTurn[];
  signal?: AbortSignal;
}

export interface AIProvider {
  /** Resolves to the full reply text. Throws AIUnavailableError when the service can't be reached. */
  reply(input: ReplyInput): Promise<string>;
  /** Resolves to exactly one sentence. Throws AIUnavailableError on failure. */
  summarize(input: SummaryInput): Promise<string>;
}

export class AIUnavailableError extends Error {}
