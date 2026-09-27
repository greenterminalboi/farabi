# Data Model: Map Interactions, Definitions, and Streaming

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md) | **Date**: 2026-09-27

Adds to Feature 1's model (`specs/001-branching-chat-map/data-model.md`) in one forward-only
migration, `0002_workspace.ts`. Nothing existing is renamed or removed; nothing is deleted.

## Enum changes

- `message_status`: add `incomplete` (error mid-reply) and `stopped` (user pressed Stop).
  `pending` now also means "streaming".
- New `marker_kind`: `selection` (Feature 1 highlight) | `whole_message` (`????` quick branch).

## Changed tables

### trees

| Column | Type | Notes |
|--------|------|-------|
| user_placed | boolean, default false | Set when the user drags the tree; stops auto-relocation (FR-020) |

### nodes

| Column | Type | Notes |
|--------|------|-------|
| manual_x | real, nullable | Hand-placed position relative to the tree origin (FR-016, FR-017) |
| manual_y | real, nullable | Both null or both set (check constraint) |

The root node is never hand-placed on its own: dragging the root moves the tree (research R6).

### messages

| Column | Type | Notes |
|--------|------|-------|
| partial_content | text, nullable | Checkpoint of the text so far while `pending` (research R2). Cleared when `content` is written. Never shown as sent text. |

`content` is still written exactly once, when a reply ends as `complete`, `incomplete` or `stopped`.

### branch_markers

| Column | Type | Notes |
|--------|------|-------|
| kind | marker_kind, default `selection` | `whole_message` markers have `start_offset = 0`, `end_offset = length(content)` and sit on a user message |

Unique partial index on `(message_id) WHERE kind = 'whole_message'`: a message can anchor at most
one quick branch (FR-012).

## New tables

### edge_label_versions (append-only)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| child_node_id | uuid FK → nodes.id | Identifies the edge (child → its one parent) |
| text | text, nullable | NULL = label cleared; trimmed, ≤ 200 characters |
| provenance | provenance | Always `user_authored` (FR-026) |
| created_at | timestamptz | |

Current label = latest row per `child_node_id`; shown only when its text is not NULL.

### definitions

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| term | text | As first captured, ≤ 120 characters |
| term_key | text, unique | Lower-cased, trimmed, inner whitespace collapsed (FR-034) |
| source_node_id | uuid FK → nodes.id | Where first captured (FR-033) |
| source_message_id | uuid FK → messages.id | Must be a `complete` message of `source_node_id` |
| draft_failed_at | timestamptz, nullable | Set when drafting fails; cleared on retry (FR-036) |
| created_at | timestamptz | |

### definition_versions (append-only)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| definition_id | uuid FK → definitions.id | |
| general_text | text | The general definition, ≤ 2 sentences (FR-029) |
| usage_text | text | How the term is used in the source conversation, 1 sentence |
| provenance | provenance | `ai_suggested` for the AI draft; `user_confirmed` for confirm or edit (FR-032) |
| created_at | timestamptz | |

Current definition = latest version. An entry with no version is "being drafted" (job running) or
"couldn't draft" (`draft_failed_at` set).

## State transitions

**AI message**: `pending` (streaming) → `complete` | `incomplete` (error after some text) |
`stopped` (user) | `failed` (error before any text). Any of the last three → retry → the row gets
`replaced_at`/`replaced_by`, a new `pending` row takes its `seq` (Feature 1 pattern).

**Definition**: created → drafting → first version (`ai_suggested`) or `draft_failed_at` →
(retry) → … → confirm/edit → new `user_confirmed` version → further edits add versions.

## Validation rules

| Rule | Source | Enforced by |
|------|--------|-------------|
| Only `complete` messages can anchor branches or definitions | spec Assumptions | Services |
| `????` exact match (trimmed) + a complete user message + not already a quick-branch anchor | FR-006, FR-012, FR-013 | Send service |
| Whole-message inherited context stops before the anchored message | FR-011 | Inherited-context query |
| `manual_x`/`manual_y` both set or both null; not on a root node | FR-016, research R6 | Check constraint + service |
| Dragging never touches `parent_id` | FR-018 | No endpoint writes `parent_id` |
| One definition per `term_key` | FR-034 | Unique index; capture returns the existing entry |
| Summaries only from `complete` messages | FR-005 | Existing summary input filter |
| No delete paths for any new table | FR-037, Article II | No DELETE endpoints; FKs `ON DELETE RESTRICT` |
