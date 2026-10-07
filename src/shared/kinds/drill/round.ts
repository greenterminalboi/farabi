import { z } from "zod";
import type { NodeKindDeclaration } from "../types";

/** A round: the act that produced its lessons and problems (research R2). */
export const drillRoundKind: NodeKindDeclaration = {
  id: "drill_round",
  label: "Drill round",
  shape: "edge",
  display: "function_connector",
  onCanvas: false,
  settings: [],
  properties: z
    .object({
      number: z.number().int().min(1),
      plan: z.array(z.object({ rungIds: z.array(z.string()).min(1).max(2), level: z.number().int().min(1).max(10) }).strict()),
      /** Why a round is short (research R8). */
      note: z.string().max(500).optional(),
    })
    .strict(),
};
