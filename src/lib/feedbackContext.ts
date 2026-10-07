import type { FeedbackView } from "@/shared/schemas";

export type FeedbackContext = { view: FeedbackView; projectId: string | null; elementId: string | null };

/**
 * Where the user is when they submit feedback (FR-058): the open project and, on the canvas, the
 * focused element, in place of Feature 3's view and conversation.
 */
export function feedbackContext(pathname: string, canvas: { projectId: string | null; focusId: string | null }): FeedbackContext {
  if (pathname === "/definitions") return { view: "definitions", projectId: canvas.projectId, elementId: null };
  if (pathname === "/") return { view: "canvas", projectId: canvas.projectId, elementId: canvas.focusId };
  return { view: "canvas", projectId: canvas.projectId, elementId: null };
}
