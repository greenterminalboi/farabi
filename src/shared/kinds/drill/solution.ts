import { z } from "zod";
import type { NodeKindDeclaration } from "../types";

/** A worked solution, made with its problem and shown after a reveal event (research R9). */
export const drillSolutionKind: NodeKindDeclaration = {
  id: "drill_solution",
  label: "Solution",
  shape: "node",
  display: "output",
  onCanvas: false,
  settings: [],
  properties: z.object({ problemId: z.string() }).strict(),
};
