// Drill AI operations (Feature 12, research R4, contracts/declarations.md): each is data, an id,
// version, instruction and output schema, run by the generic `callOperation`. Everything an
// operation produces records its id and version as function_id and function_version.
import type { z } from "zod";
import type { FakeResponder } from "../../ai/fake";

export type DrillOperation<In, Out> = {
  id: string;
  version: number;
  effort: "low" | "medium";
  maxTokens: number;
  instruction: { system: string; prompt: (input: In) => string };
  /** Validated after JSON extraction (research R5). */
  output: z.ZodType<Out>;
  /** Checks that need the input, e.g. picks must be among the candidates; returns a problem or null. */
  check?: (out: Out, input: In) => string | null;
  /** Deterministic output for the fake provider (research R16). */
  fake: FakeResponder;
};

/** The input as a tagged JSON block at the end of each prompt; the fake responders read it back. */
export function inputBlock(input: unknown): string {
  return `<input>\n${JSON.stringify(input, null, 2)}\n</input>`;
}

/** Reads the `<input>` block of a prompt (fake responders only). */
export function readInputBlock<T>(prompt: string): T {
  const match = /<input>\n([\s\S]*)\n<\/input>/.exec(prompt);
  if (!match) throw new Error("No <input> block in the prompt");
  return JSON.parse(match[1]) as T;
}
