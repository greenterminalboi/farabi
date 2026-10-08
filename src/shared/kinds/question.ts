import { z } from "zod";
import { LexiconUses } from "../lexicon/types";
import type { NodeKindDeclaration } from "./types";

/** The user's own words: an act that leads to an answer (FR-001). Drawn as a Feature 7 bubble. */
export const questionKind: NodeKindDeclaration = {
  id: "question",
  label: "Question",
  shape: "edge",
  display: "question",
  settings: [],
  contextRole: "user",
  // Feature 13: the lexicon terms the user attached (id and version), absent when none.
  properties: z.object({ lexicon: LexiconUses.optional() }).strict(),
};
