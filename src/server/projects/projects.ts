import { type Selectable, sql } from "kysely";
import type { Project } from "@/shared/schemas";
import { db } from "../db/client";
import type { ProjectsTable } from "../db/schema";
import { ConflictError, NotFoundError } from "../errors";
import { assertId } from "../ids";

// Projects (Feature 4). The open project is a per-browser cookie (plan D1). Trashing only hides a
// project; nothing is ever deleted (Article II).

export const PROJECT_COOKIE = "farabi_project";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toProject(p: Selectable<ProjectsTable>): Project {
  return {
    id: p.id,
    name: p.name,
    createdAt: p.created_at.toISOString(),
    trashedAt: p.trashed_at?.toISOString() ?? null,
  };
}

async function oldestActive(): Promise<Selectable<ProjectsTable> | undefined> {
  return db
    .selectFrom("projects")
    .selectAll()
    .where("trashed_at", "is", null)
    .orderBy("created_at")
    .orderBy("id")
    .limit(1)
    .executeTakeFirst();
}

/**
 * The open project: the cookie's project if it exists and is not trashed, else the oldest active
 * one. If there is none at all, "My first project" is created (FR-002, FR-004).
 */
export async function resolveProject(cookieId: string | undefined | null): Promise<string> {
  if (cookieId && UUID.test(cookieId)) {
    const p = await db
      .selectFrom("projects")
      .select("id")
      .where("id", "=", cookieId)
      .where("trashed_at", "is", null)
      .executeTakeFirst();
    if (p) return p.id;
  }
  const oldest = await oldestActive();
  if (oldest) return oldest.id;
  // First use: create the default once, even when several requests arrive together.
  return db.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtext('farabi:default-project'))`.execute(trx);
    const again = await trx.selectFrom("projects").select("id").where("trashed_at", "is", null).orderBy("created_at").limit(1).executeTakeFirst();
    if (again) return again.id;
    const created = await trx.insertInto("projects").values({ name: "My first project" }).returning("id").executeTakeFirstOrThrow();
    return created.id;
  });
}

function cookieValue(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function projectFromRequest(req: Request): Promise<string> {
  return resolveProject(cookieValue(req, PROJECT_COOKIE));
}

/** Set-Cookie value that makes `id` the open project in this browser for a year. */
export function projectCookie(id: string): string {
  return `${PROJECT_COOKIE}=${id}; Path=/; SameSite=Lax; Max-Age=31536000`;
}

export async function listProjects(currentId: string): Promise<{ projects: Project[]; trashed: Project[]; currentId: string }> {
  const rows = await db.selectFrom("projects").selectAll().orderBy("created_at").orderBy("id").execute();
  return {
    projects: rows.filter((r) => r.trashed_at === null).map(toProject),
    trashed: rows
      .filter((r) => r.trashed_at !== null)
      .sort((a, b) => b.trashed_at!.getTime() - a.trashed_at!.getTime())
      .map(toProject),
    currentId,
  };
}

export async function createProject(name: string): Promise<Project> {
  return toProject(await db.insertInto("projects").values({ name }).returningAll().executeTakeFirstOrThrow());
}

async function getRow(id: string): Promise<Selectable<ProjectsTable>> {
  assertId(id, "Project");
  const row = await db.selectFrom("projects").selectAll().where("id", "=", id).executeTakeFirst();
  if (!row) throw new NotFoundError("Project not found");
  return row;
}

export async function openProject(id: string): Promise<Project> {
  const row = await getRow(id);
  if (row.trashed_at) throw new ConflictError("trashed", "That project is in the trash; restore it first");
  return toProject(row);
}

/**
 * Hides a project (FR-007). Returns the project that should be open afterwards: unchanged unless
 * the open one was trashed, in which case another active project, or a new "Untitled project".
 */
export async function trashProject(id: string, currentId: string): Promise<string> {
  const row = await getRow(id);
  if (!row.trashed_at) {
    await db.updateTable("projects").set({ trashed_at: new Date() }).where("id", "=", id).execute();
  }
  if (id !== currentId) return currentId;
  const next = await oldestActive();
  if (next) return next.id;
  return (await createProject("Untitled project")).id;
}

export async function restoreProject(id: string): Promise<Project> {
  await getRow(id);
  return toProject(
    await db.updateTable("projects").set({ trashed_at: null }).where("id", "=", id).returningAll().executeTakeFirstOrThrow(),
  );
}
