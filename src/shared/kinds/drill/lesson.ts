import { z } from "zod";
import type { NodeKindDeclaration } from "../types";

/** A short lesson on a newly opened rung (FR-006). */
export const drillLessonKind: NodeKindDeclaration = {
  id: "drill_lesson",
  label: "Lesson",
  shape: "node",
  display: "output",
  onCanvas: false,
  contextRole: "ai",
  settings: [],
  properties: z.object({ rungId: z.string(), readAttachments: z.array(z.string()) }).strict(),
};
