// The side panel for a focused element (FR-022): its direct child edges, newest first, and its live
// parked tangents.
import type { PanelResponse } from "@/shared/schemas";
import { db } from "../db/client";
import { assertId } from "../ids";
import { liveParked, toParkedTangent } from "../parked/state";
import { loadLive, toElementWithExtras } from "./elements";

export async function getPanel(elementId: string): Promise<PanelResponse> {
  assertId(elementId, "Element");
  await loadLive(db, elementId);
  const [edges, parked] = await Promise.all([
    db
      .selectFrom("nodes")
      .selectAll()
      .where("parent_id", "=", elementId)
      .where("shape", "=", "edge")
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .execute(),
    liveParked(elementId),
  ]);
  return {
    children: await Promise.all(edges.map((e) => toElementWithExtras(db, e))),
    parked: parked.map((p) => toParkedTangent(p, p.question)),
  };
}
