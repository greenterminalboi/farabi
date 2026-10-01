import { notFound } from "next/navigation";
import { VIEWS } from "@/components/kinds/views";
import { db } from "@/server/db/client";
import { findKind } from "@/shared/kinds";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Opens the view the node's kind declares (Feature 9, FR-004): chat for a conversation. */
export default async function NodePage({ params }: { params: Promise<{ nodeId: string }> }) {
  const { nodeId } = await params;
  if (!UUID.test(nodeId)) notFound();
  const node = await db.selectFrom("nodes").select("kind").where("id", "=", nodeId).executeTakeFirst();
  const kind = node ? findKind(node.kind) : undefined;
  if (!kind) notFound();
  const View = VIEWS[kind.view];
  return <View key={nodeId} nodeId={nodeId} />;
}
