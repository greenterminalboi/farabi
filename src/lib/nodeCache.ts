import type { NodeView } from "@/shared/schemas";

// Last 20 node views, so returning to a node renders instantly and then revalidates (SC-006).
const MAX = 20;
const cache = new Map<string, NodeView>();

export function getCachedNode(nodeId: string): NodeView | undefined {
  return cache.get(nodeId);
}

export function setCachedNode(view: NodeView): void {
  cache.delete(view.node.id);
  cache.set(view.node.id, view);
  while (cache.size > MAX) cache.delete(cache.keys().next().value!);
}
