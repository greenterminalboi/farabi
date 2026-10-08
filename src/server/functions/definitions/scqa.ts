import type { FunctionDefinition } from "./types";
import { escape, GROUNDING, parseMethod } from "./methods";

/** SCQA (dictionary: "Situation → complication → question → answer"), restructuring one answer. */
export const scqa: FunctionDefinition = {
  id: "scqa",
  version: 1,
  name: "SCQA",
  accepts: ["answer"],
  reads: "text",
  outputKind: "scqa",
  edgeKind: "function",
  procedure: "propose",
  instruction: {
    system: () =>
      `You restructure a text as SCQA (situation, complication, question, answer), so a person can see its argument at a glance.

${GROUNDING}

Write four labelled lines: "Situation:", "Complication:", "Question:" and "Answer:", one or two sentences each. Keep the point that makes the text non-obvious; a shorter version that loses it is wrong. Reply with only the four lines.`,
    prompt: (source) => `<text>\n${escape(source.text)}\n</text>\n\nRestructure it as SCQA.`,
  },
  parse: parseMethod("SCQA"),
};
