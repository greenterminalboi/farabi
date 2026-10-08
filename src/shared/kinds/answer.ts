import { z } from "zod";
import type { NodeKindDeclaration } from "./types";

// Feature 6's reply settings stay global (spec assumption), so this kind declares none.
export const answerKind: NodeKindDeclaration = {
  id: "answer",
  label: "Answer",
  shape: "node",
  display: "answer",
  settings: [],
  contextRole: "ai",
  properties: z.object({}).strict(),
};
