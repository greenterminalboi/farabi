// App configuration that used to come only from environment variables (feature 11, data-model.md
// §3, research R8). Each key resolves to the newest `setting_changes` row, then (web app and tests
// only) its environment variable, then the default. Reads are synchronous, from a cache that is
// loaded at start-up and refreshed on every change, so callers like getAIProvider() stay sync.
//
// These are explicit user instructions about how the app runs, never evidence about how the user
// learns (Constitution Article VI, 1.0.1).
import { db } from "../db/client";
import type { SettingKey } from "../db/schema";
import { isDesktop } from "../host/bridge";

export type ConfigKey = "ai_provider" | "default_model" | "summary_trigger" | "feedback_export_dir" | "claude_code_path";
export type AIProviderKind = "claude" | "claude-code" | "fake";
export type ConfigValues = {
  ai_provider: AIProviderKind;
  default_model: string | null;
  summary_trigger: "reply" | "map";
  feedback_export_dir: string | null;
  claude_code_path: string | null;
};
export type ConfigSource = "row" | "env" | "default";
export type ResolvedConfig<K extends ConfigKey = ConfigKey> = { value: ConfigValues[K]; source: ConfigSource; changedAt: string | null };

export const CONFIG_KEYS: readonly ConfigKey[] = ["ai_provider", "default_model", "summary_trigger", "feedback_export_dir", "claude_code_path"];
const PROVIDERS: readonly AIProviderKind[] = ["claude", "claude-code", "fake"];

type Row = { value: unknown; changedAt: string };
const g = globalThis as unknown as { __farabiConfigRows?: Map<ConfigKey, Row> };

/** The environment variable a key falls back to (the web app and tests; not the desktop app). */
function fromEnv<K extends ConfigKey>(key: K, provider: AIProviderKind): ConfigValues[K] | undefined {
  if (isDesktop()) return undefined;
  const env = process.env;
  const v = (() => {
    switch (key) {
      case "ai_provider":
        return env.AI_PROVIDER && (PROVIDERS as readonly string[]).includes(env.AI_PROVIDER) ? env.AI_PROVIDER : undefined;
      case "default_model":
        return (provider === "claude-code" ? env.CLAUDE_CODE_MODEL : env.CLAUDE_MODEL) || undefined;
      case "summary_trigger":
        return env.SUMMARY_TRIGGER === "map" || env.SUMMARY_TRIGGER === "reply" ? env.SUMMARY_TRIGGER : undefined;
      case "feedback_export_dir":
        return env.FEEDBACK_DIR || undefined;
      case "claude_code_path":
        return env.CLAUDE_CODE_BIN || undefined;
    }
  })();
  return v as ConfigValues[K] | undefined;
}

function fallback<K extends ConfigKey>(key: K): ConfigValues[K] {
  const defaults: ConfigValues = {
    ai_provider: "fake",
    default_model: null,
    summary_trigger: "reply",
    // The web app always exported to the repo's feedback/ folder; the desktop app only when chosen.
    feedback_export_dir: isDesktop() ? null : "feedback",
    claude_code_path: null,
  };
  return defaults[key];
}

/** The value in effect for a key, with where it came from. */
export function resolveConfig<K extends ConfigKey>(key: K): ResolvedConfig<K> {
  const row = g.__farabiConfigRows?.get(key);
  if (row) return { value: row.value as ConfigValues[K], source: "row", changedAt: row.changedAt };
  // The default model depends on the provider in effect, so resolve that first.
  const provider = key === "default_model" ? getConfig("ai_provider") : "fake";
  const env = fromEnv(key, provider);
  if (env !== undefined) return { value: env, source: "env", changedAt: null };
  return { value: fallback(key), source: "default", changedAt: null };
}

export function getConfig<K extends ConfigKey>(key: K): ConfigValues[K] {
  return resolveConfig(key).value;
}

/**
 * The default model for a given provider: the stored `default_model`, else that provider's own
 * environment variable (CLAUDE_MODEL or CLAUDE_CODE_MODEL) in the web app, else null.
 */
export function defaultModelFor(provider: AIProviderKind): string | null {
  const row = g.__farabiConfigRows?.get("default_model");
  if (row) return row.value as string | null;
  return fromEnv("default_model", provider) ?? null;
}

export function getAllConfig(): { [K in ConfigKey]: ResolvedConfig<K> } {
  return Object.fromEntries(CONFIG_KEYS.map((k) => [k, resolveConfig(k)])) as { [K in ConfigKey]: ResolvedConfig<K> };
}

/** Loads the newest row per key into the cache. Called at start-up and after every change. */
export async function loadConfig(): Promise<void> {
  const rows = await db
    .selectFrom("setting_changes")
    .select(["key", "value", "created_at"])
    .where("key", "in", CONFIG_KEYS as SettingKey[])
    .distinctOn("key")
    .orderBy("key")
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();
  g.__farabiConfigRows = new Map(rows.map((r) => [r.key as ConfigKey, { value: r.value, changedAt: r.created_at.toISOString() }]));
}

/** Appends a user-authored change (the history is append-only) and refreshes the cache. */
export async function setConfig<K extends ConfigKey>(key: K, value: ConfigValues[K]): Promise<ResolvedConfig<K>> {
  await db.insertInto("setting_changes").values({ key, value: JSON.stringify(value) }).execute();
  await loadConfig();
  return resolveConfig(key);
}

/** Tests only: forget the cache so env and defaults apply again. */
export function resetConfigCache(): void {
  g.__farabiConfigRows = undefined;
}
