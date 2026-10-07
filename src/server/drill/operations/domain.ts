import { z } from "zod";
import { fakeDomain } from "./fakes";
import { type DrillOperation, inputBlock } from "./types";

export type DomainInput = { path: string[] };
export type DomainOutput = { domain: string };

/**
 * A drill domain from one node's root-to-node path. Reserved for "drill from any node" (research
 * R12): no route uses it yet, because the completion offer already writes domains.
 */
export const drillDomain: DrillOperation<DomainInput, DomainOutput> = {
  id: "drill_domain",
  version: 1,
  effort: "low",
  maxTokens: 2000,
  instruction: {
    system: [
      "Name a domain a learner could drill, from the conversation below: under 100 characters, like a drill title.",
      'Reply with only a JSON object: {"domain": "…"}',
    ].join("\n"),
    prompt: (input) => `Name the domain.\n\n${inputBlock(input)}`,
  },
  output: z.object({ domain: z.string().trim().min(1).max(300) }),
  fake: fakeDomain,
};
