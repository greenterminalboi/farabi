import { z } from "zod";
import type { NodeKindDeclaration } from "../types";

/** The user's attempt at a problem (FR-015): their own words, never edited. */
export const drillAttemptKind: NodeKindDeclaration = {
  id: "drill_attempt",
  label: "Attempt",
  shape: "edge",
  display: "question",
  onCanvas: false,
  contextRole: "user",
  settings: [],
  properties: z.object({}).strict(),
};
