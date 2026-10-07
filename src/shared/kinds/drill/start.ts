// Feature 12's element kinds (data-model.md "Element kinds"). Only drill_start and drill are drawn
// on the canvas; the rest live on the drill screen (`onCanvas: false`).
import { z } from "zod";
import type { NodeKindDeclaration } from "../types";

/** The user's domain: the act that starts a drill, drawn like a question (FR-001). */
export const drillStartKind: NodeKindDeclaration = {
  id: "drill_start",
  label: "Drill domain",
  shape: "edge",
  display: "question",
  contextRole: "user",
  settings: [],
  properties: z.object({}).strict(),
};
