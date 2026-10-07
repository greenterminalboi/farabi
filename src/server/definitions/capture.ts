import { termKey } from "@/shared/termKey";
import type { Definition } from "@/shared/schemas";
import { db } from "../db/client";
import { InvalidSelectionError, NotFoundError } from "../errors";
import { validateSpan } from "../graph/branch";
import { assertId } from "../ids";
import { enqueueDraft } from "./draftQueue";
import { getDefinition } from "./list";

const MAX_TERM = 120;

/**
 * Captures a highlighted term from any element with final text, outputs included (FR-055). A term
 * that already has an entry (same key) returns that entry and creates nothing; a new one starts an
 * AI draft (Feature 2).
 */
export async function captureDefinition(input: {
  nodeId: string;
  start: number;
  end: number;
  text: string;
}): Promise<{ definition: Definition; created: boolean }> {
  assertId(input.nodeId, "Element");
  const { element } = await db
    .transaction()
    .execute((trx) => validateSpan(trx, input.nodeId, input, { allowOutput: true }));
  const term = input.text.trim().replace(/\s+/g, " ");
  if (!term) throw new InvalidSelectionError("The selection is empty");
  if (term.length > MAX_TERM) throw new InvalidSelectionError(`Terms are limited to ${MAX_TERM} characters`);

  // A term belongs to the project of the element it came from (Feature 4).
  const projectId = element.project_id;
  const inserted = await db
    .insertInto("definitions")
    .values({ project_id: projectId, term, term_key: termKey(term), source_id: element.id })
    .onConflict((oc) => oc.columns(["project_id", "term_key"]).doNothing())
    .returning("id")
    .executeTakeFirst();
  if (inserted) {
    enqueueDraft(inserted.id);
    return { definition: (await getDefinition(inserted.id)).definition, created: true };
  }
  const existing = await db
    .selectFrom("definitions")
    .select("id")
    .where("project_id", "=", projectId)
    .where("term_key", "=", termKey(term))
    .executeTakeFirst();
  if (!existing) throw new NotFoundError("Definition not found");
  return { definition: (await getDefinition(existing.id)).definition, created: false };
}
