# Data Model: Farabi as a Native Desktop App (Feature 011)

This feature moves Farabi's data; it does not reshape it. Every existing table, column, trigger and
provenance rule (Features 1–10) is carried over unchanged. This document covers what is new:

- the two store backends;
- the on-disk layout;
- the settings keys that replace environment variables;
- the import audit record;
- the runtime file the CLI uses;
- the startup state machine.

## 1. Store backends

One Kysely `Database` interface (`src/server/db/schema.ts`) runs over two backends until cut-over.

| Backend | Selected when | Connection | Used by |
|---------|---------------|------------|---------|
| `pg` | `DATABASE_URL` is set | `pg.Pool`, max 10 | The web app and its tests, until cut-over (removed then) |
| `pglite` | `FARABI_DATA_DIR` is set, or the server runs under the desktop shell | One PGlite instance on `<data dir>/store/`, with the `vector` extension loaded | The desktop app; Vitest with `STORE=pglite` (in-memory, `memory://`) |

**PGlite backend rules** (`src/server/db/client.ts`, backend switch only):

- **The dialect** is Kysely's built-in `PGliteDialect` over one `PGlite` instance, created with
  `extensions: { vector }` and cached on `globalThis` exactly like today's pool.
  - The adapter reports a single connection, so Kysely serializes queries itself.
  - A transaction holds the connection from `BEGIN` to `COMMIT`/`ROLLBACK`, and other queries
    queue behind it.
  - No transaction may await an AI call or any other slow I/O.
- **Type parsers must match `pg`**:
  - `real` (OID 700) is parsed to `number`, replacing `pg.types.setTypeParser`, which is specific
    to node-postgres;
  - `timestamptz` to `Date`;
  - `jsonb` is parsed;
  - `int8` and `numeric` stay strings.

  Gate G3 proves this by running the whole integration suite on both backends (coordinator
  condition (3)).
- **Durability**: see research R2, risks and gate G2. `relaxedDurability` is left off. If G2b
  finds commits are not fsynced and the owner chooses option (b), a snapshot (`dumpDataDir()`,
  gzipped) is written to `backups/auto-<ts>.tar.gz` every 10 minutes while the store has changed,
  and on clean quit. The newest 6 are kept.
- **Exclusive use** is mandatory, because a second opener corrupts the store (PGlite issue
  #1106).
  - Before opening the store, the server creates `store.lock` with exclusive-create semantics,
    holding its pid and start time.
  - A stale lock (dead pid) is replaced.
  - A live lock makes the shell show the "Farabi is already using this data" screen.
  - Scripts never open a store whose lock is live (contracts/cli.md).
- **Clean close**: `await pglite.close()` runs on `shutdown`, `SIGTERM` and `SIGINT`, before the
  lock is removed.

## 2. Data directory layout

The root is Tauri's `app_data_dir()` for identifier `app.farabi`:

- macOS: `~/Library/Application Support/app.farabi/`
- Windows: `%APPDATA%\app.farabi\`

`FARABI_DATA_DIR` overrides it (development uses `<repo>/.farabi-dev/`).

```text
<data dir>/
├── store/                      # PGlite data directory (the database)
├── store.lock                  # pid + started_at of the process that has the store open
├── backups/
│   └── <YYYYMMDDTHHMMSSZ>-pre-<migration name>/   # full copy of store/ before an upgrade (newest 5 kept)
├── feedback/
│   └── attachments/<item id>/<file>               # canonical screenshot files (moved from FEEDBACK_DIR)
└── runtime.json                # present only while the app runs (§5); mode 0600 / owner-only ACL
```

Logs go to the OS log dir (`~/Library/Logs/app.farabi/`, `%LOCALAPPDATA%\app.farabi\logs\`),
rotated at 5 MB × 5 files, with the API key redacted.

**Feedback export folder** (setting `feedback_export_dir`, §3) is separate from the data dir. On
every regeneration the server writes `FEEDBACK.md` there and mirrors the referenced attachments
into `<export dir>/attachments/…`, so the relative paths in `FEEDBACK.md` resolve the way they do
today. The mirror is one-way: deleting the export folder loses nothing.

**Validation**:

- Every path the server writes is resolved under the data dir or the export dir. Anything that
  escapes them (`..` or absolute values in stored paths) is rejected.
- The export dir must be an existing, writable folder. If it is missing or not writable, saving
  still succeeds, and the UI shows "Feedback export could not be written to <path>" (spec, edge
  cases).

## 3. Settings keys (append-only `setting_changes`)

The existing table, its append-only trigger and its "newest row per key wins" rule are kept. A
migration widens the key `CHECK` and adds a value check per key. The values are explicit user
instructions, never evidence about how the user learns (Article VI).

| Key | Value (JSON) | Replaces env | Default when no row exists |
|-----|--------------|--------------|----------------------------|
| `information_pressure` | integer 1–10 | — (existing) | 8 |
| `reply_model` | string | — (existing) | "Default" |
| `ai_provider` | `"claude"` \| `"claude-code"` \| `"fake"` | `AI_PROVIDER` | env if set (web app and tests), else `"fake"` |
| `default_model` | string model id, or null for the default | `CLAUDE_MODEL`, `CLAUDE_CODE_MODEL` | env if set, else the current built-in default |
| `summary_trigger` | `"reply"` \| `"map"` | `SUMMARY_TRIGGER` | env if set, else `"reply"` |
| `feedback_export_dir` | absolute path string, or `null` for "don't export" | `FEEDBACK_DIR` | env if set, else `null` in the desktop app |
| `claude_code_path` | absolute path string, or `null` for "find automatically" | `CLAUDE_CODE_BIN` | `null` |

`CLAUDE_CODE_TIMEOUT_MS` stays an env-only diagnostic, with the default 180 s.

**Resolution order** (`src/server/settings/config.ts`): newest row, then the environment
variable, then the default. 010 code reads settings only through this resolver (plan,
"Coordination").

**Not a setting**: the API key. It lives in the OS credential store under service `app.farabi`,
account `anthropic-api-key` (contracts/host-bridge.md). The store holds no column, row or flag
derived from it. The UI shows "Key saved" from a `credentials.get` that returns presence only.

**Migration naming**: migration numbers are assigned by the coordinator
(`farabi-coord/STATUS.md`): 0010 is v0.2 and 0011 is drill. This feature's single migration is
**`0012_desktop`** (assigned 2026-10-07 12:15): the settings `CHECK` widening plus `import_runs`.
The merge order into v0.2 is 0010 (v0.2), then 0011 (drill), then 0012 (tauri). Like every migration, it is registered in the static list
`src/server/db/migrationList.ts`, never discovered from the filesystem at runtime, which also
lets it bundle into the standalone server.

## 4. `import_runs` (new table, append-only)

This is the audit record of the one-time import from a web-app database (FR-017, research R11).

| Column | Type | Rules |
|--------|------|-------|
| `id` | uuid | `gen_random_uuid()` |
| `source_system_identifier` | text | The source's `pg_control_system().system_identifier`; detects a repeat import |
| `source_label` | text | The connection string with the password removed |
| `schema_level` | text | Name of the newest migration on both sides (must be equal) |
| `started_at` / `finished_at` | timestamptz | — |
| `outcome` | `succeeded` \| `failed` | Failed runs are recorded **after** the rollback, in their own transaction |
| `counts` | jsonb | `{ table: { source: n, imported: n } }` |
| `checksums_match` | boolean | Ordered per-table `md5` comparison (SC-006) |
| `error` | text \| null | A user-readable failure reason |
| `provenance` | provenance | always `user_authored` (the user started it) |

Append-only, with the same trigger pattern as `setting_changes`.

**Preconditions**:

- The destination has zero rows in `projects` and `feedback_items`.
- No `succeeded` row exists for the same `source_system_identifier`.
- The source's migration list equals the app's.

**Effect on success**: every source table is copied with ids, timestamps and provenance unchanged.
Sequences are reset. Attachment files are copied from the source `FEEDBACK_DIR` (asked for if it
is not in the default location) into `<data dir>/feedback/attachments/`.

## 5. `runtime.json`

This file is written by the server once it is ready, and deleted on clean shutdown. A stale file
(dead pid) is ignored and overwritten.

```json
{ "pid": 12345, "port": 51873, "secret": "<base64url, 32 bytes>", "startedAt": "2026-10-07T09:00:00Z", "appVersion": "0.2.0", "schemaLevel": "0012_desktop" }
```

Owner-only permissions. The secret only works for this launch and this loopback port, and grants
no more than the window has. It is not the API key. Used only by the CLI (contracts/cli.md).

## 6. Startup state machine (server, desktop mode)

```text
launching ──hello──▶ locking ──lock ok──▶ checking-schema
                        │                     │
                        └─live lock─▶ [screen: already open]
checking-schema ──unknown migrations in store──▶ [screen: data from a newer Farabi] (read nothing, write nothing)
checking-schema ──pending migrations──▶ backing-up ──copy verified──▶ migrating ──ok──▶ ready
                                            │                             │
                                            └─fail─▶ [screen: backup failed, nothing changed]
                                                                          └─fail─▶ [screen: upgrade failed, restored from backup]
checking-schema ──up to date──▶ ready ──▶ regenerate feedback export ──▶ write runtime.json ──▶ send `ready`
ready ──shutdown / window closed──▶ draining (finish checkpoints, ≤ 3 s) ──▶ close store ──▶ remove runtime.json + lock ──▶ exit
```

A reply still streaming at shutdown is stopped the way **Stop** stops it today: the text so far is
kept and the answer is finalized as partial (spec, edge case "Reply interrupted").
