// Models the user can choose for chat replies (Feature 6, FR-015). "default" is the model the app
// is configured with (CLAUDE_MODEL or CLAUDE_CODE_MODEL).
export const REPLY_MODELS = [
  { id: "default", label: "Default" },
  { id: "claude-opus-5", label: "Claude Opus 5" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
] as const;

export type ReplyModelChoice = (typeof REPLY_MODELS)[number]["id"];

export function isReplyModelChoice(x: unknown): x is ReplyModelChoice {
  return REPLY_MODELS.some((m) => m.id === x);
}

/** Label for a reply's recorded model: "Default model" when unresolved, the raw id if unknown. */
export function modelLabel(id: string | null): string {
  if (id === null) return "Default model";
  return REPLY_MODELS.find((m) => m.id === id)?.label ?? id;
}
