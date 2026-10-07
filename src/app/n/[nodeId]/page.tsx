import { notFound, permanentRedirect } from "next/navigation";
import { resolveElementId } from "@/server/graph/resolve";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `/n/<id>` from v0.1 opens the canvas focused on that element, or on a v1 conversation's first edge (R18). */
export default async function NodeRedirect({ params }: { params: Promise<{ nodeId: string }> }) {
  const { nodeId } = await params;
  if (!UUID.test(nodeId)) notFound();
  const id = await resolveElementId(nodeId);
  if (!id) notFound();
  permanentRedirect(`/?focus=${id}`);
}
