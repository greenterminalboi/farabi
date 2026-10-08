// Settings declared by kinds (FR-053, research R14). Every change is a new user-authored row,
// kind-level (node_id null) or an override on one element: a function edge (for its output kind)
// or, since Feature 12 (C6), any element whose own kind declares settings. The newest row per scope
// is in effect and a null value means "not set here" (Article VI). Saving never runs a function.
import { findKind, getKind, kindsWithSettings, type SettingDeclaration } from "@/shared/kinds";
import type { KindSettingsResponse, ResolvedSetting } from "@/shared/schemas";
import { db, type DB, type Trx } from "../db/client";
import { ConflictError, InvalidRequestError } from "../errors";
import { getFunction } from "../functions/definitions";
import { type ElementRow, loadLive } from "../graph/elements";
import { assertId } from "../ids";

type Row = { key: string; node_id: string | null; value: unknown; created_at: Date };

/** Newest row per (key, scope) for a kind, for kind-level and optionally one node. */
async function latestRows(kind: string, nodeId: string | null, q: DB | Trx): Promise<Row[]> {
  return q
    .selectFrom("kind_setting_changes")
    .select(["key", "node_id", "value", "created_at"])
    .where("kind", "=", kind)
    .where((eb) => (nodeId ? eb.or([eb("node_id", "is", null), eb("node_id", "=", nodeId)]) : eb("node_id", "is", null)))
    .distinctOn(["key", "node_id"])
    .orderBy("key")
    .orderBy("node_id")
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();
}

const isChoice = (decl: SettingDeclaration, value: unknown): value is string =>
  typeof value === "string" && decl.choices.some((c) => c.value === value);

function resolve(decl: SettingDeclaration, rows: Row[], nodeId: string | null): ResolvedSetting {
  const kindRow = rows.find((r) => r.key === decl.key && r.node_id === null);
  const nodeRow = nodeId ? rows.find((r) => r.key === decl.key && r.node_id === nodeId) : undefined;
  // A value no longer among the choices reads as unset.
  const kindValue = kindRow && isChoice(decl, kindRow.value) ? kindRow.value : null;
  if (nodeRow && isChoice(decl, nodeRow.value)) {
    return { key: decl.key, value: nodeRow.value, source: "override", kindValue, changedAt: nodeRow.created_at.toISOString() };
  }
  if (kindValue !== null) {
    return { key: decl.key, value: kindValue, source: "kind", kindValue, changedAt: kindRow!.created_at.toISOString() };
  }
  return { key: decl.key, value: decl.default, source: "default", kindValue: null, changedAt: null };
}

/**
 * Each declared setting of a kind, resolved: edge override, then kind value, then default. Pass the
 * open transaction as `q` when inside one: PGlite has a single connection, so `db` would deadlock.
 */
export async function resolveKindSettings(kind: string, nodeId: string | null = null, q: DB | Trx = db): Promise<ResolvedSetting[]> {
  const decl = getKind(kind);
  if (decl.settings.length === 0) return [];
  const rows = await latestRows(kind, nodeId, q);
  return decl.settings.map((s) => resolve(s, rows, nodeId));
}

export async function resolvedValues(kind: string, nodeId: string | null = null, q: DB | Trx = db): Promise<Record<string, string>> {
  return Object.fromEntries((await resolveKindSettings(kind, nodeId, q)).map((s) => [s.key, s.value]));
}

export async function listKindSettings(): Promise<KindSettingsResponse> {
  const kinds = kindsWithSettings();
  return {
    kinds: await Promise.all(
      kinds.map(async (k) => ({ kind: k.id, label: k.label, settings: await resolveKindSettings(k.id) })),
    ),
  };
}

function declaration(kind: string, key: string, value: string | null): SettingDeclaration {
  const decl = getKind(kind).settings.find((s) => s.key === key);
  if (!decl) throw new InvalidRequestError(`"${key}" isn't a setting of this kind`);
  if (value !== null && !isChoice(decl, value)) throw new InvalidRequestError(`"${value}" isn't an allowed value for ${decl.label}`);
  return decl;
}

async function record(kind: string, key: string, nodeId: string | null, value: string | null): Promise<void> {
  const rows = await latestRows(kind, nodeId, db);
  const current = rows.find((r) => r.key === key && r.node_id === nodeId);
  const currentValue = typeof current?.value === "string" ? current.value : null;
  if (currentValue === value) return; // unchanged: nothing to record
  const decl = getKind(kind);
  if (decl.validateSettings) {
    // The values as they would resolve after this change, for the scope being changed.
    const next = rows.filter((r) => !(r.key === key && r.node_id === nodeId));
    if (value !== null) next.push({ key, node_id: nodeId, value, created_at: new Date() });
    const values = Object.fromEntries(decl.settings.map((s) => [s.key, resolve(s, next, nodeId).value]));
    const problem = decl.validateSettings(values);
    if (problem) throw new InvalidRequestError(problem);
  }
  await db
    .insertInto("kind_setting_changes")
    .values({ kind, key, node_id: nodeId, value: value === null ? null : JSON.stringify(value) })
    .execute();
}

function settingOf(settings: ResolvedSetting[], key: string): ResolvedSetting {
  return settings.find((s) => s.key === key)!;
}

/** Sets or clears (null) the value for every element of a kind. */
export async function setKindSetting(kind: string, key: string, value: string | null): Promise<{ setting: ResolvedSetting }> {
  if (!findKind(kind)) throw new InvalidRequestError(`Unknown kind "${kind}"`);
  declaration(kind, key, value);
  await record(kind, key, null, value);
  return { setting: settingOf(await resolveKindSettings(kind), key) };
}

const isFunctionEdge = (el: ElementRow) => el.origin === "run" && el.shape === "edge" && el.function_id !== null;

/** The kind whose settings an element overrides: a function edge's output kind, or its own. */
async function settingsKindOf(elementId: string, what: string, functionEdgesOnly: boolean): Promise<string> {
  assertId(elementId, what);
  const el = await loadLive(db, elementId);
  if (isFunctionEdge(el)) return getFunction(el.function_id!).outputKind;
  if (!functionEdgesOnly && getKind(el.kind).settings.length > 0) return el.kind;
  throw new ConflictError("wrong_kind", functionEdgesOnly ? "Only a function edge has settings" : "This element has no settings", {
    kind: el.kind,
  });
}

/** An element's settings, resolved: its override, then the kind value, then the default. */
export async function elementSettings(elementId: string): Promise<{ kind: string; settings: ResolvedSetting[] }> {
  const kind = await settingsKindOf(elementId, "Element", false);
  return { kind, settings: await resolveKindSettings(kind, elementId) };
}

/** A function edge's settings, resolved: its override, then the kind value, then the default. */
export async function edgeSettings(edgeId: string): Promise<{ kind: string; settings: ResolvedSetting[] }> {
  const kind = await settingsKindOf(edgeId, "Edge", true);
  return { kind, settings: await resolveKindSettings(kind, edgeId) };
}

/**
 * Sets or clears (null) the override on one element (C6). For a function edge it is a setting its
 * output kind declares and applies to that edge's next run only (FR-053).
 */
export async function setElementSetting(elementId: string, key: string, value: string | null): Promise<{ setting: ResolvedSetting }> {
  const kind = await settingsKindOf(elementId, "Element", false);
  declaration(kind, key, value);
  await record(kind, key, elementId, value);
  return { setting: settingOf(await resolveKindSettings(kind, elementId), key) };
}

/** Sets or clears the override on one function edge (FR-053). */
export async function setEdgeSetting(edgeId: string, key: string, value: string | null): Promise<{ setting: ResolvedSetting }> {
  const kind = await settingsKindOf(edgeId, "Edge", true);
  declaration(kind, key, value);
  await record(kind, key, edgeId, value);
  return { setting: settingOf(await resolveKindSettings(kind, edgeId), key) };
}
