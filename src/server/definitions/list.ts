import type { Selectable } from "kysely";
import { sql } from "kysely";
import type { Definition, DefinitionVersion, TermIndexEntry } from "@/shared/schemas";
import { db } from "../db/client";
import type { DefinitionsTable, DefinitionVersionsTable } from "../db/schema";
import { NotFoundError } from "../errors";
import { assertId } from "../ids";
import { isDrafting } from "./draftQueue";

type VersionRow = Pick<Selectable<DefinitionVersionsTable>, "general_text" | "usage_text" | "provenance" | "created_at">;

export function toVersion(v: VersionRow): DefinitionVersion {
  return {
    generalText: v.general_text,
    usageText: v.usage_text,
    provenance: v.provenance === "user_confirmed" ? "user_confirmed" : "ai_suggested",
    createdAt: v.created_at.toISOString(),
  };
}

export function toDefinition(d: Selectable<DefinitionsTable>, latest: VersionRow | undefined): Definition {
  let status: Definition["status"];
  if (latest) status = latest.provenance === "user_confirmed" ? "confirmed" : "draft";
  // No version yet: drafting, unless it failed or the job was lost (e.g. a restart).
  else status = isDrafting(d.id) ? "drafting" : "failed";
  return {
    id: d.id,
    term: d.term,
    termKey: d.term_key,
    source: { nodeId: d.source_node_id, messageId: d.source_message_id },
    status,
    current: latest ? toVersion(latest) : null,
    createdAt: d.created_at.toISOString(),
  };
}

async function latestVersions(ids: string[]): Promise<Map<string, VersionRow>> {
  if (ids.length === 0) return new Map();
  const { rows } = await sql<VersionRow & { definition_id: string }>`
    SELECT DISTINCT ON (definition_id) definition_id, general_text, usage_text, provenance, created_at
    FROM definition_versions
    WHERE definition_id = ANY(${ids}::uuid[])
    ORDER BY definition_id, created_at DESC, id DESC
  `.execute(db);
  return new Map(rows.map((r) => [r.definition_id, r]));
}

/** Every entry of a project, newest first (FR-031). */
export async function listDefinitions(projectId: string): Promise<Definition[]> {
  const defs = await db
    .selectFrom("definitions")
    .selectAll()
    .where("project_id", "=", projectId)
    .orderBy("created_at", "desc")
    .execute();
  const latest = await latestVersions(defs.map((d) => d.id));
  return defs.map((d) => toDefinition(d, latest.get(d.id)));
}

/** Compact index for marking terms in text (FR-036a). */
export async function termIndex(projectId: string): Promise<TermIndexEntry[]> {
  const rows = await db
    .selectFrom("definitions")
    .select(["id", "term", "term_key"])
    .where("project_id", "=", projectId)
    .execute();
  return rows.map((r) => ({ id: r.id, term: r.term, termKey: r.term_key }));
}

export async function getDefinition(id: string): Promise<{ definition: Definition; versions: DefinitionVersion[] }> {
  assertId(id, "Definition");
  const def = await db.selectFrom("definitions").selectAll().where("id", "=", id).executeTakeFirst();
  if (!def) throw new NotFoundError("Definition not found");
  const versions = await db
    .selectFrom("definition_versions")
    .selectAll()
    .where("definition_id", "=", id)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();
  return { definition: toDefinition(def, versions[0]), versions: versions.map(toVersion) };
}
