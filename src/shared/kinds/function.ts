import { z } from "zod";
import type { NodeKindDeclaration } from "./types";

/** A function application: the act from an input node to its outputs (FR-048). */
export const functionKind: NodeKindDeclaration = {
  id: "function",
  label: "Function",
  shape: "edge",
  display: "function_connector",
  settings: [],
  properties: z.object({}).strict(),
};
