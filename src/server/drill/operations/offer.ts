import { z } from "zod";
import { fakeOffer } from "./fakes";
import { type DrillOperation, inputBlock } from "./types";

/** Each candidate's text is cut to this many characters. */
export const CANDIDATE_CHARS = 1500;
export const MAX_PICKS = 3;

export type OfferInput = {
  domain: string;
  ladder: string[];
  /** The drill's own follow-ups and attached conversations (FR-032). */
  candidates: Array<{ nodeId: string; text: string }>;
};
export type OfferOutput = { picks: Array<{ nodeId: string; domain: string }> };

/** Up to 3 starting points for new drills, chosen only from the candidates (FR-032). */
export const drillOffer: DrillOperation<OfferInput, OfferOutput> = {
  id: "drill_offer",
  version: 1,
  effort: "medium",
  maxTokens: 2000,
  instruction: {
    system: [
      "A learner just finished drilling a domain. From the candidates, which are the learner's own follow-up questions",
      "and attached conversations, pick up to 3 that would make a good next drill, and write a short domain for each",
      "(under 100 characters, like a drill title). Pick only from the candidates, by nodeId; pick none if none fit.",
      'Reply with only a JSON object: {"picks": [{"nodeId": "…", "domain": "…"}]}',
    ].join("\n"),
    prompt: (input) =>
      `Choose next drills.\n\n${inputBlock({ ...input, candidates: input.candidates.map((c) => ({ ...c, text: c.text.slice(0, CANDIDATE_CHARS) })) })}`,
  },
  output: z.object({
    picks: z.array(z.object({ nodeId: z.string(), domain: z.string().trim().min(1).max(300) })).max(MAX_PICKS),
  }),
  check: (out, input) => {
    const ids = new Set(input.candidates.map((c) => c.nodeId));
    if (out.picks.some((p) => !ids.has(p.nodeId))) return "Pick only nodeIds from the candidates";
    if (new Set(out.picks.map((p) => p.nodeId)).size !== out.picks.length) return "Pick each candidate at most once";
    return null;
  },
  fake: fakeOffer,
};
