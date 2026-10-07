/**
 * A function (FR-046, contracts/declarations.md): plain data that the generic runner executes.
 * Adding a function means adding a definition; the runner never changes (SC-013).
 */
export type FunctionDefinition = {
  id: string;
  /** Bump when the instruction changes; every output records the version that made it. */
  version: number;
  name: string;
  /** Input kinds it can run on (shape node only in v0.2, FR-047). */
  accepts: string[];
  /** The input node's own immutable text. */
  reads: "text";
  /** The kind of node it creates (shape node); its settings are the ones this function is given. */
  outputKind: string;
  /** The act it is recorded as: a function edge from the input to its outputs (FR-048). */
  edgeKind: "function";
  /** The only procedure so far: the output is ai_suggested and waits for the user's review. */
  procedure: "propose";
  instruction: {
    system: (settings: Record<string, string>) => string;
    prompt: (source: { text: string }, settings: Record<string, string>) => string;
  };
  /** Cleans the model's answer; throws AIUnavailableError when it can't be used. */
  parse: (text: string) => string;
};
