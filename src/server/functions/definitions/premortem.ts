import type { FunctionDefinition } from "./types";
import { escape, GROUNDING, parseMethod } from "./methods";

/** Premortem (dictionary: "Imagine failure in advance and ask why"), run on one answer. */
export const premortem: FunctionDefinition = {
  id: "premortem",
  version: 1,
  name: "Premortem",
  accepts: ["answer"],
  reads: "text",
  outputKind: "premortem",
  edgeKind: "function",
  procedure: "propose",
  instruction: {
    system: () =>
      `You run a premortem on a plan, claim or recommendation, to help a person see its risks in advance.

${GROUNDING}

Assume it is a year from now and following the text turned out badly. List the three to five most plausible reasons it failed, most likely first. For each, name the assumption or gap in the text it comes from, and one early warning sign. Use a short numbered list, at most about 200 words. Reply with only the list.`,
    prompt: (source) => `<text>\n${escape(source.text)}\n</text>\n\nRun the premortem.`,
  },
  parse: parseMethod("premortem"),
};
