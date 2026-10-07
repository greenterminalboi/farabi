import { z } from "zod";
import type { NodeKindDeclaration } from "./types";

/** The user's own words: an act that leads to an answer (FR-001). Drawn as a Feature 7 bubble. */
export const questionKind: NodeKindDeclaration = {
  id: "question",
  label: "Question",
  shape: "edge",
  display: "question",
  settings: [],
  properties: z.object({}).strict(),
};
