import { z } from "zod";
import type { NodeKindDeclaration } from "./types";

/** The output of the Premortem method (Feature 13, research R7): an AI reading of one answer. */
export const premortemKind: NodeKindDeclaration = {
  id: "premortem",
  label: "Premortem",
  shape: "node",
  display: "output",
  acceptsInputKinds: ["answer"],
  settings: [],
  properties: z.object({}).strict(),
};
