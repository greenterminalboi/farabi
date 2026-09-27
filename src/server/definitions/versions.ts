import type { Definition } from "@/shared/schemas";
import { db } from "../db/client";
import { ConflictError, InvalidRequestError, NotFoundError } from "../errors";
import { assertId } from "../ids";
import { enqueueDraft } from "./draftQueue";
import { getDefinition } from "./list";

async function latest(id: string) {
  assertId(id, "Definition");
  const def = await db.selectFrom("definitions").select("id").where("id", "=", id).executeTakeFirst();
  if (!def) throw new NotFoundError("Definition not found");
  return db
    .selectFrom("definition_versions")
    .selectAll()
    .where("definition_id", "=", id)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
}

/** Accepts the current text unchanged: a new `user_confirmed` version (FR-032, Article I). */
export async function confirmDefinition(id: string): Promise<Definition> {
  const current = await latest(id);
  if (!current) throw new ConflictError("nothing_to_confirm", "There is no definition to confirm yet");
  if (current.provenance !== "user_confirmed") {
    await db
      .insertInto("definition_versions")
      .values({
        definition_id: id,
        general_text: current.general_text,
        usage_text: current.usage_text,
        provenance: "user_confirmed",
      })
      .execute();
  }
  return (await getDefinition(id)).definition;
}

/** Saves the user's edit as a new `user_confirmed` version; earlier ones are kept (FR-035). */
export async function saveDefinitionEdit(id: string, generalText: string, usageText: string): Promise<Definition> {
  await latest(id);
  const general = generalText.trim();
  const usage = usageText.trim();
  if (!general || !usage) throw new InvalidRequestError("Both parts of the definition are needed");
  await db
    .insertInto("definition_versions")
    .values({ definition_id: id, general_text: general, usage_text: usage, provenance: "user_confirmed" })
    .execute();
  return (await getDefinition(id)).definition;
}

/** Retries a failed draft (FR-036). */
export async function redraftDefinition(id: string): Promise<void> {
  if (await latest(id)) throw new ConflictError("already_drafted", "This definition already has text");
  await db.updateTable("definitions").set({ draft_failed_at: null }).where("id", "=", id).execute();
  enqueueDraft(id);
}
