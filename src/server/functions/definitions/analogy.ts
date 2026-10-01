import { AIUnavailableError } from "../../ai/provider";
import type { FunctionDefinition } from "./types";

const REACH: Record<string, string> = {
  close: "something from a neighbouring field",
  everyday: "something from everyday life",
  far: "something from a distant, surprising domain",
};

const LENGTH: Record<string, string> = {
  one_line: "one sentence",
  short: "two or three sentences",
  paragraph: "one paragraph of at most about 120 words",
};

const escape = (text: string) => text.replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Analogy (research R8). It reads only the user's own summary, and every claim about the idea
 * must come from it; the comparison is AI-supplied and always shown as such (Article III).
 */
export const analogy: FunctionDefinition = {
  id: "analogy",
  version: 1,
  name: "Analogy",
  accepts: ["conversation"],
  reads: "summary",
  outputKind: "analogy",
  procedure: "propose",
  instruction: {
    system: (settings) =>
      `You write one analogy that helps a person grasp an idea from their own learning notes. You are given a one-sentence summary of where one of their conversations ended up.

Explain that idea by comparing it to ${REACH[settings.reach] ?? REACH.everyday}. Every claim about the idea must come from the summary: don't add facts, conclusions or opinions it doesn't contain. The analogy is an aid to understanding, not a new insight.

Write ${LENGTH[settings.length] ?? LENGTH.short}. Reply with only the analogy.`,
    prompt: (source) => `<summary>\n${escape(source.text)}\n</summary>\n\nWrite the analogy.`,
  },
  parse: (text) => {
    const clean = text
      .trim()
      .replace(/^["“”'`]+|["“”'`]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean) throw new AIUnavailableError("The analogy came back empty");
    return clean;
  },
};
