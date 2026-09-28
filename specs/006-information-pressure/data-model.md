# Data Model: Information Pressure

Migration `0006_information_pressure.ts` (forward-only).

## `setting_changes` (new, append-only)

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | |
| `key` | `text NOT NULL CHECK (key IN ('information_pressure', 'reply_model'))` | |
| `value` | `jsonb NOT NULL` | A number for `information_pressure`, a string for `reply_model` |
| `provenance` | `provenance NOT NULL DEFAULT 'user_authored' CHECK (provenance = 'user_authored')` | Article I |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |

- **Constraints**:
  - `CHECK (key <> 'information_pressure' OR (jsonb_typeof(value) = 'number' AND (value)::int BETWEEN 1 AND 10))`
  - `CHECK (key <> 'reply_model' OR jsonb_typeof(value) = 'string')`. The allowed IDs are
    checked in code against `REPLY_MODELS`, so the model list can change without a migration.
- **Index**: `setting_changes_latest ON (key, created_at DESC, id DESC)`.
- **Trigger**: `setting_changes_append_only` runs BEFORE UPDATE OR DELETE and raises an exception
  (FR-013, FR-020, Article VI).
- **Current value**: the newest row for the key, or the default when there are none:
  `information_pressure` → 8, `reply_model` → `"default"`. A stored `reply_model` that isn't in
  `REPLY_MODELS` reads as `"default"` (edge case).

## `messages` (two new nullable columns)

| Column | Type | Notes |
|--------|------|-------|
| `pressure_level` | `smallint CHECK (pressure_level BETWEEN 1 AND 10)` | Set only on AI messages, at insert |
| `reply_model` | `text` | The resolved model ID, or NULL when "Default" can't be resolved |

- Both are written only by `insertPendingReply`, in the INSERT, and never updated (FR-010).
- User messages and replies from before this feature leave both NULL.
- `pressure_level IS NULL` on an AI message means "from before this feature": the UI shows no
  level and no model.

## Shared types (`src/shared/`)

```ts
// models.ts
export const REPLY_MODELS = [
  { id: "default", label: "Default" },
  { id: "claude-opus-5", label: "Claude Opus 5" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
] as const;
export type ReplyModelChoice = (typeof REPLY_MODELS)[number]["id"];
export function modelLabel(id: string | null): string; // "Default model" for null, raw id if unknown

// pressure.ts
export const PRESSURE_BANDS = ["Brief", "Concise", "Balanced", "Detailed", "Exhaustive"] as const;
export const DEFAULT_PRESSURE = 8;
export function bandOf(level: number): (typeof PRESSURE_BANDS)[number]; // Math.ceil(level / 2) - 1
```

The `Message` schema gains `pressureLevel: number | null` and `replyModel: string | null`.
