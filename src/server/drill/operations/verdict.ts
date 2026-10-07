import { z } from "zod";
import { fakeVerdict } from "./fakes";
import { type DrillOperation, inputBlock } from "./types";

export type VerdictInput = {
  domain: string;
  rungNames: string[];
  problem: string;
  /** The hidden worked solution, as a reference (research R9). */
  solution: string;
  attempt: string;
  hinted: boolean;
};
export type VerdictOutput = { verdict: "solved" | "partly_solved" | "not_solved"; feedback: string };

/** Judges one attempt (FR-016): a verdict and feedback about the attempt's own content. */
export const drillVerdict: DrillOperation<VerdictInput, VerdictOutput> = {
  id: "drill_verdict",
  version: 1,
  effort: "low",
  maxTokens: 2000,
  instruction: {
    system: [
      "You judge one attempt at a practice problem. Compare it with the reference solution, but accept any correct approach.",
      "verdict: solved (correct and complete), partly_solved (right idea, a real gap or error), not_solved (wrong, empty or off-topic).",
      "feedback: 1–4 sentences in markdown that refer to what the attempt actually says: what is right, and what is wrong or missing.",
      "Don't reveal the full solution; point at the gap instead. An empty or off-topic attempt is not_solved, and say so.",
      'Reply with only a JSON object: {"verdict": "solved" | "partly_solved" | "not_solved", "feedback": "…"}',
    ].join("\n"),
    prompt: (input) => `Judge this attempt.\n\n${inputBlock(input)}`,
  },
  output: z.object({
    verdict: z.enum(["solved", "partly_solved", "not_solved"]),
    feedback: z.string().trim().min(1).max(4000),
  }),
  fake: fakeVerdict,
};
