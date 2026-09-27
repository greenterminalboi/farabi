# Data Model: Branching Chat with Map View

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md) | **Date**: 2026-09-26

Postgres 17 + pgvector (research R2), adjacency-list model. All ids are UUIDs. All timestamps are `timestamptz`,
set by the database. No row in this model is ever updated in a way that changes meaning;
the only updates are setting `replaced_at`/`replaced_by` on a regenerated message and
`layout_origin_*` on a tree.

## Enums

- `provenance`: `ai_suggested` | `user_confirmed` | `user_authored` (Constitution Article I)
- `message_role`: `user` | `ai`
- `message_status`: `pending` | `complete` | `failed`

## Tables

### trees

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| root_node_id | uuid FK → nodes.id, unique, deferrable | Set in the same transaction as the root node |
| layout_origin_x | real | Persisted map origin (research R4) |
| layout_origin_y | real | |
| created_at | timestamptz | |

### nodes

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| tree_id | uuid FK → trees.id | |
| parent_id | uuid FK → nodes.id, nullable | Null only for the root |
| provenance | provenance | Always `user_authored` in v1 (FR-016) |
| created_at | timestamptz | |

The node's anchor is its incoming branch marker (`branch_markers.child_node_id = nodes.id`).
Roots have none.

### branch_markers

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| parent_node_id | uuid FK → nodes.id | |
| message_id | uuid FK → messages.id | Message containing the anchor; must belong to `parent_node_id` |
| child_node_id | uuid FK → nodes.id, unique | Exactly one marker per non-root node |
| start_offset | int | Into the message's stored text (research R6) |
| end_offset | int | `end_offset > start_offset` |
| anchor_text | text | Exact selected text; `= substring(content, start, end)` |
| prefix | text | Up to 32 chars before the anchor |
| suffix | text | Up to 32 chars after the anchor |
| provenance | provenance | Always `user_authored` in v1 |
| created_at | timestamptz | |

### messages

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| node_id | uuid FK → nodes.id | |
| seq | int | Order within the node; unique with `node_id` among non-replaced messages |
| role | message_role | |
| content | text | Never updated once `status = complete` (FR-028) |
| status | message_status | `pending` while an AI reply is being produced |
| provenance | provenance | `ai_suggested` for `ai`, `user_authored` for `user` |
| replaced_at | timestamptz, nullable | Set when regenerated (FR-030) |
| replaced_by | uuid FK → messages.id, nullable | The new reply |
| created_at | timestamptz | |

### node_summaries (append-only)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| node_id | uuid FK → nodes.id | |
| text | text | One sentence |
| provenance | provenance | Always `ai_suggested` in v1 (FR-014) |
| through_message_id | uuid FK → messages.id | Last message included; traceability (Article V) |
| created_at | timestamptz | |

Current summary = latest row per `node_id`. A node with no rows shows a placeholder (FR-011).

## Relationships

```text
trees 1 ── 1 nodes (root)          trees 1 ── * nodes
nodes 1 ── * nodes (parent_id)     nodes 1 ── * messages
nodes 1 ── * branch_markers (as parent)
nodes 1 ── 0..1 branch_markers (as child; roots have none)
messages 1 ── * branch_markers     nodes 1 ── * node_summaries
```

## Validation rules

| Rule | Source | Enforced by |
|------|--------|-------------|
| `parent_id` null ⇔ node is its tree's root | FR-001, FR-003 | Service + check on insert |
| Child's `tree_id` = parent's `tree_id` | Tree entity | Service (in branch transaction) |
| Selection non-empty, within one message, offsets in range, `anchor_text` matches substring | FR-002, FR-003 | Zod + service |
| Branch source message must be `complete` and not replaced | FR-002, R6 | Service |
| Completed message content is never updated | FR-028 | Service; no update path exists |
| Regenerate only the latest non-replaced AI message, and only if it has no markers | FR-029 | Service → 409 |
| No delete paths for nodes, trees, markers, messages | FR-009, spec assumption | No delete endpoints; FKs `ON DELETE RESTRICT` |
| Summary generation uses only the node's own messages + anchor | FR-012 | AI boundary ([contracts/ai-provider.md](./contracts/ai-provider.md)) |

## State transitions

**Message**: `pending` → `complete` | `failed`. `failed` → (user retries) a new `pending`
message with the same content; the failed row is kept. `complete` AI message → replaced
(`replaced_at` set) only via regenerate, under the FR-029 rule.

**Node summary**: none → first summary (after first complete AI reply) → newer summary rows.
On generation failure, no row is written; the previous summary stays current.

## Key queries

- **Forest for the map**: all trees, nodes, parent links, anchors, current summaries — one
  query with `DISTINCT ON (node_id)` over `node_summaries`.
- **Inherited context for a branch** (FR-005, FR-033): recursive CTE up the ancestor chain;
  for each ancestor, its non-replaced messages with `seq` ≤ the seq of the message holding the
  next-lower branch point.
- **Tree subtree**: recursive CTE down `parent_id` (future use; also used by tests).

## Future-proofing (FR-024, FR-027)

- Per-tree summaries and level-of-detail rendering: `tree_id`, `parent_id`, anchors and
  current summaries already exist; a `tree_summaries` table can be added without touching
  existing rows.
- Accounts: a `users` table and nullable `trees.owner_id` can be added and back-filled to a
  single default user; no existing data changes shape.
- Embeddings: the `vector` extension is enabled; columns can be added when needed (R3).
