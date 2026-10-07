// One short note per edge, kept as history (FR-040). Replaces Feature 2's edge labels.
import type { Element } from "@/shared/schemas";
import { db } from "../db/client";
import { ConflictError, InvalidRequestError } from "../errors";
import { assertId } from "../ids";
import { loadLive, toElementWithExtras } from "./elements";

export const MAX_NOTE = 200;

/** Sets, changes or clears an edge's note. Every call appends a user-authored version. */
export async function setNote(edgeId: string, text: string | null): Promise<Element> {
  assertId(edgeId, "Edge");
  const note = text?.trim().replace(/\s+/g, " ") || null;
  if (note && note.length > MAX_NOTE) throw new InvalidRequestError(`Notes are limited to ${MAX_NOTE} characters`);
  return db.transaction().execute(async (trx) => {
    const edge = await loadLive(trx, edgeId);
    if (edge.shape !== "edge") throw new ConflictError("not_an_edge", "Only an edge can have a note");
    await trx.insertInto("edge_notes").values({ edge_id: edgeId, text: note }).execute();
    return toElementWithExtras(trx, edge);
  });
}
