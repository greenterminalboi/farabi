import { z } from "zod";
import type { NodeKindDeclaration } from "./types";

// Feature 6's reply settings stay global (spec assumption), so this kind declares none.
export const conversationKind: NodeKindDeclaration = {
  id: "conversation",
  label: "Conversation",
  conversationBacked: true,
  view: "chat",
  mapLabel: "summary",
  settings: [],
  properties: z.object({}).strict(),
};
