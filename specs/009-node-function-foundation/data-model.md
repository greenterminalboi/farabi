# Data Model: Node Function Foundation

Migration `src/server/db/migrations/0009_node_functions.ts` is forward-only, like the others.
Every new table is append-only and enforced by a trigger. Nothing is deleted (FR-037), and no
existing row changes meaning (FR-038).

## `nodes` (extended)

| Column | Type | Notes |
|--------|------|-------|
| `kind` | `text NOT NULL` | Backfilled `'conversation'`, then the default is dropped. Validated against the kind registry on insert (R1, R2). |
| `origin` | `text NOT NULL` | `CHECK IN ('root','branch','quick_branch','parked','function')`. Backfilled as described in research R1. |
| `function_id` | `text NULL` | |
| `function_version` | `integer NULL` | `CHECK ((origin = 'function') = (function_id IS NOT NULL AND function_version IS NOT NULL))` |
| `properties` | `jsonb NOT NULL DEFAULT '{}'` | `CHECK (jsonb_typeof(properties) = 'object')`. Keys are validated by the kind's strict schema (FR-035). |

- New constraint: `CHECK (kind = 'conversation' OR parent_id IS NULL)`. Non-conversation nodes
  are never children (FR-017).
- **Unchanged**:
  - `tree_id`: outputs and pipes use their input's tree (FR-011).
  - `provenance`: creation provenance. `user_authored` for conversations, `ai_suggested` for
    outputs and pipes (FR-028, FR-036).
  - `manual_x` and `manual_y`: outputs are draggable (FR-039).
  - `created_at`.
- Index: `nodes_kind_tree ON nodes (tree_id, kind)`.

**Kinds in this feature** (declarations in `src/shared/kinds/`, FR-003):

| Kind | conversationBacked | view | mapLabel | settings | acceptsInputKinds | properties |
|------|-------------------|------|----------|----------|-------------------|------------|
| `conversation` | yes | `chat` | `summary` | none (Feature 6 stays global) | n/a | `{}` |
| `analogy` | no | `output_beside_input` | `output_text` | `reach`, `length` (research R7) | `['conversation']` | `{}` |
| `pipe` | no | `pipe` | none (drawn as a connector) | none | n/a | `{}` |

No kind in this feature declares properties. The strict empty schema still rejects every key, so
FR-035 is enforced from the start, and later kinds declare their keys.

## `pipes` (new; one row per pipe node)

| Column | Type | Notes |
|--------|------|-------|
| `node_id` | `uuid PK REFERENCES nodes(id)` | The pipe's own node (kind `pipe`). |
| `input_node_id` | `uuid NOT NULL REFERENCES nodes(id)` | Indexed. |
| `output_node_id` | `uuid NOT NULL UNIQUE REFERENCES nodes(id)` | Exactly one pipe feeds each output. |
| `reads` | `text NOT NULL` | `CHECK IN ('summary','conversation','anchor')` |
| `function_id` | `text NOT NULL` | |
| `function_version` | `integer NOT NULL` | The version that created the output; later regenerations record theirs on the version row. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |

- `CHECK (input_node_id <> output_node_id)`.
- Append-only trigger: a pipe can never be re-pointed or reversed (FR-015).
- Same-tree and same-project rule: the runner inserts the input, output and pipe nodes with one
  `tree_id` in one transaction (FR-013). There is no cross-tree path.

## `function_output_versions` (new)

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid PK` | |
| `output_node_id` | `uuid NOT NULL REFERENCES nodes(id)` | |
| `text` | `text NOT NULL` | `CHECK (btrim(text) <> '')` |
| `source_version` | `uuid NOT NULL` | The version of the part that was read, captured before the AI call. For `summary` it is the `node_summaries.id` (FR-021). |
| `function_version` | `integer NOT NULL` | |
| `settings` | `jsonb NOT NULL` | The resolved settings used, e.g. `{"reach":"everyday","length":"short"}`. |
| `provenance` | `provenance NOT NULL DEFAULT 'ai_suggested'` | `CHECK (provenance = 'ai_suggested')` (FR-025, FR-028). |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |

- `UNIQUE (id, output_node_id)` is the target of the events' composite FK.
- Index: `(output_node_id, created_at DESC, id DESC)`.
- Append-only trigger (FR-025, FR-037).

## `function_output_events` (new; user review actions)

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid PK` | |
| `output_node_id` | `uuid NOT NULL REFERENCES nodes(id)` | |
| `kind` | `text NOT NULL` | `CHECK IN ('confirmed','rejected')` |
| `version_id` | `uuid NULL` | `CHECK ((kind = 'confirmed') = (version_id IS NOT NULL))` |
| `provenance` | `provenance NOT NULL` | `CHECK ((kind = 'confirmed' AND provenance = 'user_confirmed') OR (kind = 'rejected' AND provenance = 'user_authored'))` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |

- `FOREIGN KEY (version_id, output_node_id) REFERENCES function_output_versions (id,
  output_node_id)`. A confirmation always names a version of the same output.
- Index: `(output_node_id, created_at DESC, id DESC)`.
- Append-only trigger (FR-027, FR-037).

## `kind_setting_changes` (new)

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid PK` | |
| `kind` | `text NOT NULL` | |
| `key` | `text NOT NULL` | |
| `node_id` | `uuid NULL REFERENCES nodes(id)` | `NULL` = kind level; set = override on that node. |
| `value` | `jsonb NULL` | `NULL` = cleared at this scope. |
| `provenance` | `provenance NOT NULL DEFAULT 'user_authored'` | `CHECK (provenance = 'user_authored')` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | FR-032 |

- Index: `(kind, key, node_id, created_at DESC, id DESC)`.
- Append-only trigger.
- App-level validation: `key` is declared by `kind`, and `value` is null or one of its choices.
  A `node_id` must be a node of `kind` (FR-033).

## `node_summaries` (unchanged columns)

- An append-only trigger is added. The latest row's `id` is the summary version (FR-020,
  research R4).

## Derived state (no storage)

This lives in `src/server/functions/state.ts`. It is computed per output from its versions,
events, pipe, and the reader's current version for the input.

```text
review          = kind of newest event, or 'proposed'
confirmedVersion = version_id of newest 'confirmed' event (if any)
latestVersion   = newest version
displayed       = review == 'confirmed' ? confirmedVersion : latestVersion
pendingDraft    = review == 'confirmed' && latestVersion.id != confirmedVersion.id
stale           = latestVersion.source_version != currentVersion(pipe.reads, pipe.input)
provenance      = review == 'confirmed' ? 'user_confirmed' : 'ai_suggested'
shownOnMap      = review != 'rejected'   (unless "Show rejected" is on)
```

Settings resolution (per kind, key and optional node):

```text
override  = newest row (kind, key, node_id = node)  → value unless null
kindLevel = newest row (kind, key, node_id IS NULL) → value unless null
resolved  = override ?? kindLevel ?? declaration.default
```

## State transitions (output review)

| From | Action | To |
|------|--------|----|
| (none) | run succeeds | `proposed` (version 1) |
| `proposed` | confirm latest | `confirmed` |
| `proposed` | reject | `rejected` |
| `confirmed` | regenerate | `confirmed` + `pendingDraft` (confirmed text still displayed) |
| `confirmed` + `pendingDraft` | confirm the draft | `confirmed` (draft now displayed) |
| `confirmed` | reject | `rejected` |
| `rejected` | confirm latest | `confirmed` (shown again) |

- Regenerate is allowed in every state. It appends a version and doesn't change `review`, except
  that a `proposed` output simply shows the newer text.
- Confirm must target the latest version (409 `not_latest`).
- Nothing leaves the tables. Every arrow appends an event or a version.

## Relationships

```text
trees 1─* nodes(kind=conversation) 1─* messages / node_summaries / branch_markers   (unchanged)
nodes(conversation) 1─* pipes (input_node_id)
pipes 1─1 nodes(kind=pipe)      (node_id)
pipes 1─1 nodes(kind=analogy)   (output_node_id)
nodes(analogy) 1─* function_output_versions 1─* function_output_events (confirmed)
nodes(analogy) 1─* function_output_events (rejected)
nodes(any kind with settings) 0─* kind_setting_changes (overrides); kind-level rows have node_id NULL
```
