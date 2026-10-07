import { z } from "zod";
import { fakeLadder } from "./fakes";
import { type DrillOperation, inputBlock } from "./types";

/** An attached conversation as the AI reads it (FR-031): its root-to-node path, as text. */
export type AttachedText = { nodeId: string; text: string };

export type LadderInput = { domain: string; attachments: AttachedText[] };
export type LadderOutput = { rungs: string[]; note?: string };

/** The ladder for a domain (FR-002): ordered rungs, basic to advanced. */
export const drillLadder: DrillOperation<LadderInput, LadderOutput> = {
  id: "drill_ladder",
  version: 1,
  effort: "medium",
  maxTokens: 2000,
  instruction: {
    system: [
      "You design practice ladders for a learner who wants to drill one domain until they know it well.",
      "A ladder is an ordered list of rungs. Each rung is one named, practicable part of the domain,",
      "from the most basic operation to the most advanced. Each rung builds on the ones before it.",
      "Rung names are short (under 80 characters) and concrete, e.g. for Python dictionaries:",
      '"Create a dict and add entries", "Look up values safely", "Iterate over keys, values and items".',
      "Give 3 to 12 rungs; a narrow domain may have fewer. If the domain is too broad to drill,",
      "propose a ladder anyway for its core and say so in `note`.",
      "Only use attached conversations, when given, to choose and order rungs; never claim anything about the learner.",
      'Reply with only a JSON object: {"rungs": ["…", "…"], "note": "optional, one sentence"}',
    ].join("\n"),
    prompt: (input) =>
      [
        `Propose a ladder for this domain: ${input.domain}`,
        input.attachments.length ? "Attached conversations the learner chose are included below." : "",
        inputBlock(input),
      ]
        .filter(Boolean)
        .join("\n\n"),
  },
  output: z.object({
    rungs: z.array(z.string().trim().min(1).max(120)).min(1).max(12),
    note: z.string().max(500).optional(),
  }),
  fake: fakeLadder,
};
