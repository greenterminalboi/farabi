import { z } from "zod";
import type { NodeKindDeclaration } from "../types";

/** The AI's verdict on one attempt, with feedback (FR-016). */
export const drillVerdictKind: NodeKindDeclaration = {
  id: "drill_verdict",
  label: "Verdict",
  shape: "node",
  display: "output",
  onCanvas: false,
  contextRole: "ai",
  settings: [],
  properties: z
    .object({
      verdict: z.enum(["solved", "partly_solved", "not_solved"]),
      /** A hint was shown before the attempt (FR-018). */
      hinted: z.boolean(),
    })
    .strict(),
};
