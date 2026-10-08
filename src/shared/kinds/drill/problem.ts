import { z } from "zod";
import type { NodeKindDeclaration } from "../types";

/** One practice problem (FR-012): its rungs, level, place in the round and what informed it. */
export const drillProblemKind: NodeKindDeclaration = {
  id: "drill_problem",
  label: "Problem",
  shape: "node",
  display: "output",
  onCanvas: false,
  contextRole: "ai",
  settings: [],
  properties: z
    .object({
      rungIds: z.array(z.string()).min(1).max(2),
      level: z.number().int().min(1).max(10),
      position: z.number().int().min(0),
      /** Earlier attempts whose mistakes it targets (FR-013). */
      informedBy: z.array(z.string()),
      readAttachments: z.array(z.string()),
      /** The flagged problem it replaces (FR-014). */
      replaces: z.string().optional(),
    })
    .strict(),
};
