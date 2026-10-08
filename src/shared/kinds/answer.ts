import { z } from "zod";
import { LexiconUses } from "../lexicon/types";
import type { NodeKindDeclaration } from "./types";

// Feature 6's reply settings stay global (spec assumption), so this kind declares none.
export const answerKind: NodeKindDeclaration = {
  id: "answer",
  label: "Answer",
  shape: "node",
  display: "answer",
  settings: [],
  contextRole: "ai",
  // Feature 13: the lexicon terms (id and version) this reply was sent, absent when none.
  properties: z.object({ lexicon: LexiconUses.optional() }).strict(),
};
