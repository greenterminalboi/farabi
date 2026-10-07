// Settings declared by kinds (FR-053, research R14). Every change is a new user-authored row,
// kind-level (node_id null) or an override on one function edge; the newest row per scope is in
// effect and a null value means "not set here" (Article VI). Saving never runs a function.
import { findKind, getKind, kindsWithSettings, type SettingDeclaration } from "@/shared/kinds";
import type { KindSettingsResponse, ResolvedSetting } from "@/shared/schemas";
import { db } from "../db/client";
import { ConflictError, InvalidRequestError } from "../errors";
import { getFunction } from "../functions/definitions";
import { loadLive } from "../graph/elements";
import { assertId } from "../ids";

type Row = { key: string; node_id: string | null; value: unknown; created_at: Date };

/** Newest row per (key, scope) for a kind, for kind-level and optionally one node. */
async function latestRows(kind: string, nodeId: string | null): Promise<Row[]> {
  return db
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

/** Each declared setting of a kind, resolved: edge override, then kind value, then default. */
export async function resolveKindSettings(kind: string, nodeId: string | null = null): Promise<ResolvedSetting[]> {
  const decl = getKind(kind);
  if (decl.settings.length === 0) return [];
  const rows = await latestRows(kind, nodeId);
  return decl.settings.map((s) => resolve(s, rows, nodeId));
}

export async function resolvedValues(kind: string, nodeId: string | null = null): Promise<Record<string, string>> {
  return Object.fromEntries((await resolveKindSettings(kind, nodeId)).map((s) => [s.key, s.value]));
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
  const rows = await latestRows(kind, nodeId);
  const current = rows.find((r) => r.key === key && r.node_id === nodeId);
  const currentValue = typeof current?.value === "string" ? current.value : null;
  if (currentValue === value) return; // unchanged: nothing to record
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

/** A function edge's settings, resolved: its override, then the kind value, then the default. */
export async function edgeSettings(edgeId: string): Promise<{ kind: string; settings: ResolvedSetting[] }> {
  assertId(edgeId, "Edge");
  const edge = await loadLive(db, edgeId);
  if (edge.origin !== "run" || edge.shape !== "edge" || edge.function_id === null) {
    throw new ConflictError("wrong_kind", "Only a function edge has settings", { kind: edge.kind });
  }
  const kind = getFunction(edge.function_id).outputKind;
  return { kind, settings: await resolveKindSettings(kind, edgeId) };
}

/**
 * Sets or clears (null) the override on one function edge, for a setting its output kind declares
 * (FR-053). It applies to that edge's next run only.
 */
export async function setEdgeSetting(edgeId: string, key: string, value: string | null): Promise<{ setting: ResolvedSetting }> {
  assertId(edgeId, "Edge");
  const edge = await loadLive(db, edgeId);
  if (edge.origin !== "run" || edge.shape !== "edge" || edge.function_id === null) {
    throw new ConflictError("wrong_kind", "Only a function edge has settings", { kind: edge.kind });
  }
  const kind = getFunction(edge.function_id).outputKind;
  declaration(kind, key, value);
  await record(kind, key, edgeId, value);
  return { setting: settingOf(await resolveKindSettings(kind, edgeId), key) };
}
