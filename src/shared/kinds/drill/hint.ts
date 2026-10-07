import { z } from "zod";
import type { NodeKindDeclaration } from "../types";

/** A one-line hint, made with its problem and shown after a hint event (research R9). */
export const drillHintKind: NodeKindDeclaration = {
  id: "drill_hint",
  label: "Hint",
  shape: "node",
  display: "output",
  onCanvas: false,
  settings: [],
  properties: z.object({ problemId: z.string() }).strict(),
};
