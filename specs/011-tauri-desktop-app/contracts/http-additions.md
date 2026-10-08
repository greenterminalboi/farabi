# Contract: New and Changed HTTP Routes

All existing routes (28 handlers) keep their request and response shapes, so the UI and feature
010 need no change. The routes below are new or extended. They follow the existing `withApi`
error envelope (`src/server/http/withApi.ts`) and zod schemas in `src/shared/schemas.ts`.

In web mode, every `host/*` route that needs the shell returns `501 { error: "unsupported" }`,
and the Settings UI hides or replaces those controls.

## Settings

> **As built (2026-10-07):** the new keys live on their own route, `GET/PUT /api/settings/app`, so
> v0.2's `/api/settings` (informationPressure, replyModel) keeps its shape and code untouched. `GET`
> returns `{ mode, config: { <key>: { value, source, changedAt } }, exportStatus }`; `PUT` takes
> `{ key, value }`. `summary_trigger` is accepted but has no effect: v0.2 removed the trigger as dead
> code (b54929e), so Settings doesn't show it. Errors use the existing envelope
> `{ error: { code, message }, ...extra }`.

### `GET /api/settings` (extended, superseded by the note above)

Adds the new keys, each in the existing `{ value, source, changedAt }` shape (`source` is `row`,
`env` or `default`):

```json
{
  "information_pressure": { "value": 8, "source": "default", "changedAt": null },
  "reply_model": { "...": "existing" },
  "ai_provider": { "value": "claude-code", "source": "row", "changedAt": "2026-10-07T09:00:00Z" },
  "default_model": { "value": "claude-opus-5", "source": "default", "changedAt": null },
  "summary_trigger": { "value": "map", "source": "row", "changedAt": "…" },
  "feedback_export_dir": { "value": "/Users/me/Projects/farabi/feedback", "source": "row", "changedAt": "…" },
  "claude_code_path": { "value": null, "source": "default", "changedAt": null }
}
```

### `PUT /api/settings` (extended)

Body is `{ key, value }` for any key above. It is validated against data-model.md §3, and it
appends a row (append-only). For `feedback_export_dir`, the folder must exist and be writable,
otherwise `422 { error: "folder_not_writable" }`. A valid value triggers a regeneration of the
export.

## Host

| Method & path | Body | Response | Notes |
|---------------|------|----------|-------|
| `GET /api/host/info` | — | `{ mode: "desktop" \| "web", appVersion, platform, dataDir, logDir, schemaLevel }` | `dataDir` and `logDir` are shown in Settings (FR-019) |
| `POST /api/host/reveal` | `{ target: "data" \| "logs" \| "export" }` | `204` | No arbitrary paths |
| `POST /api/host/pick-folder` | `{ purpose: "feedback_export" \| "import_attachments" \| "claude_code" }` | `{ path: string \| null }` | Native dialog; `claude_code` picks a file |
| `GET /api/host/snapshots` | — | `{ snapshots: [{ name, takenAt, bytes }] }` | T074 |
| `POST /api/host/snapshots` | `{ name }` | `202` | Stages the restore, then the shell restarts the server, which loads it before opening the store |
| `GET /api/host/api-key` | — | `{ present: boolean }` | Never returns the key |
| `PUT /api/host/api-key` | `{ value: string }` (trimmed, 20–512 chars) | `204` | Stores it in the OS credential store. Optional `?verify=1` makes one 1-token API call and returns `422 { error: "key_rejected" }` on 401 |
| `PUT /api/host/api-key` | `{ value: null }` | `204` | Removes the key. No DELETE handler: the Article II guard forbids DELETE/PATCH routes |
| `GET /api/host/claude-code` | — | `{ status: "not_found" \| "found" \| "signed_out", path?: string, version?: string, checkedAt }` | Runs the discovery and probe (research R8); cached 60 s, `?refresh=1` bypasses |

## Missing provider configuration (FR-014)

Every route that starts AI work (send, ask, branch, define, function runs) checks the provider
before writing anything:

As built, inside the usual envelope: `422 { "error": { "code": "provider_not_ready", "message" }, "provider", "reason", "settingsPath" }`.

```json
422 { "error": "provider_not_ready", "provider": "claude" | "claude-code", "reason": "no_api_key" | "claude_code_not_found" | "claude_code_signed_out", "settingsPath": "/settings#provider" }
```

The UI keeps the composer text, shows the reason, and links to `settingsPath`. No question edge
or pending answer is created, so no partial graph state is left behind.

## Import (FR-017)

| Method & path | Body | Response |
|---------------|------|----------|
| `POST /api/host/import/check` | `{ connectionString, attachmentsDir? }` | `{ ready: true, counts }` or `{ ready: false, reason: "destination_not_empty" \| "already_imported" \| "source_unreachable" \| "schema_behind" \| "schema_ahead", detail }` |
| `POST /api/host/import` | same | `{ runId, outcome: "succeeded", counts, checksumsMatch: true }`, or `409`/`422` with a reason as above, or `500 { outcome: "failed", runId, error }` after rollback |

The import runs synchronously in the request; the UI shows a blocking progress state. At the
owner's data size this takes seconds. It writes an `import_runs` row for each outcome
(data-model.md §4).

## Feedback (CLI support, research R9)

### `POST /api/feedback/{id}/addressed`

Bearer-authenticated (CLI). The route itself checks the bearer secret and answers `404` to the
window's cookie and in the web app (a narrow exception to the "no app route sets addressed" guard,
logged for coordinator review). It has the same semantics as `markAddressed()` today:

| Response | Meaning |
|----------|---------|
| `200 { result: "addressed" }` | The item was `open` and is now addressed (`ai_suggested`) |
| `409 { result: "not_open", state }` | The item was not `open`; nothing changed |
| `404` | No such item |

It never confirms, reopens or edits; those remain the user's actions in the app.
