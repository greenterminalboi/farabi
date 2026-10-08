// Request and response shapes for the desktop app's own routes (feature 11,
// contracts/http-additions.md). Kept apart from schemas.ts so other lanes' edits there don't collide.
import { z } from "zod";

export const AI_PROVIDERS = ["claude", "claude-code", "fake"] as const;
export const AIProviderKind = z.enum(AI_PROVIDERS);

const Resolved = <T extends z.ZodType>(value: T) =>
  z.object({ value, source: z.enum(["row", "env", "default"]), changedAt: z.string().nullable() });

export const AppConfig = z.object({
  ai_provider: Resolved(AIProviderKind),
  default_model: Resolved(z.string().nullable()),
  summary_trigger: Resolved(z.enum(["reply", "map"])),
  feedback_export_dir: Resolved(z.string().nullable()),
  claude_code_path: Resolved(z.string().nullable()),
});
export type AppConfig = z.infer<typeof AppConfig>;

export const ExportStatus = z.object({ ok: z.boolean(), at: z.string(), dir: z.string().nullable(), error: z.string().nullable() });

export const AppSettingsResponse = z.object({
  mode: z.enum(["desktop", "web"]),
  config: AppConfig,
  exportStatus: ExportStatus.nullable(),
});
export type AppSettingsResponse = z.infer<typeof AppSettingsResponse>;

export const SaveAppSettingBody = z.discriminatedUnion("key", [
  z.object({ key: z.literal("ai_provider"), value: AIProviderKind }),
  z.object({ key: z.literal("default_model"), value: z.string().trim().min(1).max(200).nullable() }),
  z.object({ key: z.literal("summary_trigger"), value: z.enum(["reply", "map"]) }),
  z.object({ key: z.literal("feedback_export_dir"), value: z.string().min(1).max(4096).nullable() }),
  z.object({ key: z.literal("claude_code_path"), value: z.string().min(1).max(4096).nullable() }),
]);
export type SaveAppSettingBody = z.infer<typeof SaveAppSettingBody>;

export const HostInfo = z.object({
  mode: z.enum(["desktop", "web"]),
  appVersion: z.string().nullable(),
  platform: z.string(),
  dataDir: z.string().nullable(),
  logDir: z.string().nullable(),
  schemaLevel: z.string().nullable(),
});
export type HostInfo = z.infer<typeof HostInfo>;

export const RevealBody = z.object({ target: z.enum(["data", "logs", "export"]) });
export const PickFolderBody = z.object({ purpose: z.enum(["feedback_export", "import_attachments", "claude_code"]) });
export const PickFolderResponse = z.object({ path: z.string().nullable() });

export const ApiKeyStatus = z.object({ present: z.boolean() });
export const SaveApiKeyBody = z.object({ value: z.string().trim().min(20).max(512).nullable() });

export const ClaudeCodeStatus = z.object({
  status: z.enum(["not_found", "found", "signed_out"]),
  path: z.string().optional(),
  version: z.string().optional(),
  checkedAt: z.string(),
});
export type ClaudeCodeStatus = z.infer<typeof ClaudeCodeStatus>;

export const ProviderNotReadyReason = z.enum(["no_api_key", "claude_code_not_found", "claude_code_signed_out"]);
export type ProviderNotReadyReason = z.infer<typeof ProviderNotReadyReason>;

export const Snapshot = z.object({ name: z.string(), takenAt: z.string(), bytes: z.number() });
export const SnapshotsResponse = z.object({ snapshots: z.array(Snapshot) });
export const RestoreSnapshotBody = z.object({ name: z.string().regex(/^auto-\d{8}T\d{6}Z\.tar\.gz$/) });

export const ImportBody = z.object({
  connectionString: z.string().min(1).max(2048),
  attachmentsDir: z.string().min(1).max(4096).optional(),
});
export const ImportRefusal = z.enum(["destination_not_empty", "already_imported", "source_unreachable", "schema_behind", "schema_ahead"]);
export type ImportRefusal = z.infer<typeof ImportRefusal>;
export const ImportCounts = z.record(z.string(), z.number());
export const ImportCheckResponse = z.union([
  // upgradeFrom: the source's schema level when it is older; its data is upgraded during the import.
  z.object({ ready: z.literal(true), counts: ImportCounts, upgradeFrom: z.string().optional() }),
  z.object({ ready: z.literal(false), reason: ImportRefusal, detail: z.string() }),
]);
export type ImportCheckResponse = z.infer<typeof ImportCheckResponse>;
export const ImportResult = z.object({
  runId: z.string(),
  outcome: z.literal("succeeded"),
  counts: ImportCounts,
  checksumsMatch: z.literal(true),
  attachmentsCopied: z.number(),
});
export type ImportResult = z.infer<typeof ImportResult>;
