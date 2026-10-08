import { AIUnavailableError } from "../../ai/provider";

// Shared by the lexicon's method definitions (Feature 13, research R7).

export const escape = (text: string) => text.replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Article III: the method works on the person's own text and adds no outside facts. */
export const GROUNDING =
  "Work only from the text below, an AI answer from the person's own conversation. Every claim about its subject must come from that text: don't add facts, figures or conclusions it doesn't contain. Where the text is silent, say so rather than filling the gap.";

/** Keeps the model's markdown, trimmed; refuses an empty answer. */
export function parseMethod(name: string) {
  return (text: string): string => {
    const clean = text.trim();
    if (!clean) throw new AIUnavailableError(`The ${name} came back empty`);
    return clean;
  };
}
