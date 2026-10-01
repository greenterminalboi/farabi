import type { SourcePart } from "../../db/schema";

/**
 * A node function (Feature 9, FR-007): plain data that the generic runner executes. Adding a
 * function means adding a definition; the runner never changes (FR-008).
 */
export type FunctionDefinition = {
  id: string;
  /** Bump when the instruction changes; every output records the version that made it. */
  version: number;
  name: string;
  /** Node kinds it can run on (FR-009). */
  accepts: string[];
  /** Which part of the input node it reads. */
  reads: SourcePart;
  /** The kind of node it creates; its settings are the ones this function is given. */
  outputKind: string;
  /** The only procedure so far: the output is ai_suggested and waits for the user's review. */
  procedure: "propose";
  instruction: {
    system: (settings: Record<string, string>) => string;
    prompt: (source: { text: string }, settings: Record<string, string>) => string;
  };
  /** Cleans the model's answer; throws AIUnavailableError when it can't be used. */
  parse: (text: string) => string;
};
