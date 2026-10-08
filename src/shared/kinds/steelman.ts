import { z } from "zod";
import type { NodeKindDeclaration } from "./types";

/** The output of the Steelman method (Feature 13, research R7): an AI reading of one answer. */
export const steelmanKind: NodeKindDeclaration = {
  id: "steelman",
  label: "Steelman",
  shape: "node",
  display: "output",
  acceptsInputKinds: ["answer"],
  settings: [],
  properties: z.object({}).strict(),
};
