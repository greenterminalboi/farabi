import { z } from "zod";
import type { NodeKindDeclaration } from "./types";

/** The link from a function's input to its output; drawn as a connector, not a box (FR-014). */
export const pipeKind: NodeKindDeclaration = {
  id: "pipe",
  label: "Pipe",
  conversationBacked: false,
  view: "pipe",
  mapLabel: "none",
  settings: [],
  properties: z.object({}).strict(),
};
