import type { FunctionDefinition } from "./types";
import { escape, GROUNDING, parseMethod } from "./methods";

/** Steelman–critique–synthesize (dictionary: "Build the best case for a view, critique it, then merge what survives"). */
export const steelman: FunctionDefinition = {
  id: "steelman",
  version: 1,
  name: "Steelman",
  accepts: ["answer"],
  reads: "text",
  outputKind: "steelman",
  edgeKind: "function",
  procedure: "propose",
  instruction: {
    system: () =>
      `You test the main position in a text in three steps, to help a person judge it fairly.

${GROUNDING}

Write three short labelled parts: "Steelman:" the strongest version of the text's main position, as its best advocate would put it; "Critique:" its most serious weaknesses, judged on the text's own reasoning; "Synthesis:" what survives the critique, in one or two sentences. At most about 220 words in total. Reply with only the three parts.`,
    prompt: (source) => `<text>\n${escape(source.text)}\n</text>\n\nSteelman, critique and synthesize its main position.`,
  },
  parse: parseMethod("steelman"),
};
