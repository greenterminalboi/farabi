import type { FeedbackView } from "@/shared/schemas";

const NODE_ROUTE = /^\/n\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

/** Where the user is when they submit feedback (research R2, FR-006). */
export function feedbackContext(pathname: string): { view: FeedbackView; nodeId: string | null } {
  const node = NODE_ROUTE.exec(pathname);
  if (node) return { view: "chat", nodeId: node[1] };
  if (pathname === "/map") return { view: "map", nodeId: null };
  if (pathname === "/definitions") return { view: "definitions", nodeId: null };
  return { view: "chat", nodeId: null };
}
