# Data Model: Farabi v0.2 — Message Graph and Canvas

Migration `src/server/db/migrations/0010_message_graph.ts`. Decisions are in
[research.md](./research.md) (R1 to R5, R14, R16). The conversion of existing data is in
[contracts/migration.md](./contracts/migration.md).

## Overview

```text
projects ─┬─< trees ─< nodes (shape node|edge, one parent each) ─┬─< edge_notes
          │                    ▲ parent_id                        ├─< output_reviews
          │                    └──────────────┘                   ├─< parked_tangents ─< parked_tangent_events
          ├─ project_cameras                                      └─< kind_setting_changes (overrides)
          ├─< definitions (source_id → nodes) ─< definition_versions
          └─< feedback_items (project_id, element_id → nodes)

schema v1 (frozen): trees, nodes, messages, branch_markers, node_summaries, edge_label_versions,
  parked_tangents, parked_tangent_events, pipes, function_output_versions,
  function_output_events, kind_setting_changes
v1_conversion (ledger), v1_checksums
```

A tree's elements alternate. In this table, "content node" means a row with shape `node`:

| Element | Shape | Its parent |
|---------|-------|------------|
| origin edge (question) | edge | none |
| question edge | edge | a content node, or an edge when branching from the user's own words or after an unanswered edge |
| answer | node | its question edge. Every attempt is a sibling. |
| function edge | edge | the content node it ran on |
| function output | node | its function edge. Every run is a sibling. |

## Moved, unchanged: schema `v1`

The tables listed above move with `ALTER TABLE … SET SCHEMA v1`. Rows, ids, constraints and
indexes are untouched. Each table gets `v1_frozen`, a `BEFORE UPDATE OR DELETE FOR EACH ROW`
trigger that raises. Inserts stay possible, but only test fixtures do them, and a guard test keeps
app code away from `v1` (R2).

The existing append-only triggers on these tables stay as they are.

## New tables

### `trees`

| Column | Type | Rules |
|--------|------|-------|
| id | uuid PK | the v1 tree id for converted trees |
| project_id | uuid NOT NULL → projects | |
| layout_origin_x, layout_origin_y | real NOT NULL | world position of the origin edge's box |
| user_placed | boolean NOT NULL DEFAULT false | true once the user drags the tree. It is then never moved automatically (FR-038). |
| created_at | timestamptz NOT NULL DEFAULT clock_timestamp() | |

Mutable columns: the origin and `user_placed`. These are presentation data, as in Feature 2.

### `nodes`

Every graph element (FR-001, FR-009).

| Column | Type | Rules |
|--------|------|-------|
| id | uuid PK | The v1 message, node or pipe id for converted rows (R3). |
| project_id | uuid NOT NULL → projects | Same as its tree's project. |
| tree_id | uuid NOT NULL → trees | |
| parent_id | uuid NULL | `(parent_id, tree_id) → nodes(id, tree_id)`: a parent is always in the same tree, so trees never share elements (FR-005). |
| kind | text NOT NULL | A registered kind (`answer`, `question`, `function`, `analogy`). The app validates it against the registry, and no database list exists, so adding a kind needs no migration (FR-046). |
| shape | text NOT NULL CHECK IN ('node','edge') | Copied from the kind declaration (FR-043). |
| origin | text NOT NULL CHECK IN ('origin','ask','branch','quick_branch','parked','reply','retry','regenerate','run') | How it came to exist (FR-009). |
| provenance | provenance NOT NULL | question: `user_authored`. answer, function, analogy: `ai_suggested` (FR-061). A user `confirmed` review is recorded in `output_reviews`, never by changing this column. |
| text | text NULL | question: null while unsent, set exactly once on send (FR-008). answer: `''` while pending, then the final text, written once. analogy: the output text. function: null. |
| status | text NULL CHECK IN ('pending','complete','incomplete','stopped','failed') | Answers only. NULL for other kinds. |
| partial_text | text NULL | Checkpoint of a pending answer, about once a second (Feature 2). Cleared on finalize. |
| pressure_level | smallint NULL CHECK 1..10 | Answers: set at insert (Feature 6). |
| reply_model | text NULL | Answers: set at insert (Feature 6). |
| anchor_start, anchor_end | integer NULL | Edges with origin `branch` or `parked`: the span in the parent's text. CHECK `0 <= start < end`. |
| anchor_text, anchor_prefix, anchor_suffix | text NULL | Exact anchor and 32 characters of context on each side (Feature 1). |
| requery_of | uuid NULL UNIQUE → nodes | Quick branch (`????`): the edge being re-asked. UNIQUE means one re-ask per edge (FR-020). |
| function_id, function_version | text NULL, integer NULL | Function edges and outputs (FR-048). |
| properties | jsonb NOT NULL DEFAULT '{}' | Keys declared by the kind or function. The app rejects undeclared keys (FR-054). |
| manual_x, manual_y | real NULL | Hand placement relative to the tree origin. Both or neither (FR-037). |
| sent_at | timestamptz NULL | Question edges: when the text was sent. |
| created_at | timestamptz NOT NULL DEFAULT clock_timestamp() | |

**Constraints and indexes**

- `UNIQUE (id, tree_id)`, the target of the parent foreign key.
- `UNIQUE (tree_id) WHERE parent_id IS NULL`: one origin edge per tree.
- `CHECK (parent_id IS NOT NULL OR (shape = 'edge' AND origin = 'origin'))`: only an origin edge
  has no parent.
- `CHECK (shape = 'edge' OR text IS NOT NULL)`: content nodes always have text.
- `CHECK ((anchor_start IS NULL) = (anchor_end IS NULL) AND (anchor_start IS NULL) = (anchor_text IS NULL))`,
  plus `CHECK (anchor_start IS NULL OR origin IN ('branch','parked'))`.
- `CHECK (requery_of IS NULL OR origin = 'quick_branch')`.
- `CHECK ((manual_x IS NULL) = (manual_y IS NULL))`.
- `CHECK ((origin = 'run') = (function_id IS NOT NULL AND function_version IS NOT NULL))`.
- `CHECK (jsonb_typeof(properties) = 'object')`.
- Indexes:
  - `nodes (tree_id)`
  - `nodes (parent_id, created_at, id)`, for children in order
  - `nodes (project_id)`
  - `nodes (parent_id) WHERE status = 'pending'`

**Triggers**

- **`nodes_shape_rule`** (BEFORE INSERT): a content node's parent must be an edge. An edge's
  parent may be either shape.
- **`nodes_guard`** (BEFORE UPDATE OR DELETE). DELETE always raises (FR-008, Article II). An
  UPDATE is allowed only when it is exactly one of:
  1. **Send.** For question edges: `text` and `sent_at` go from NULL to set together, with nothing
     else changing.
  2. **Checkpoint.** `partial_text` changes while `status = 'pending'`.
  3. **Finalize.** `status` moves from `pending` to one of `complete`, `incomplete`, `stopped` or
     `failed`. `text` may be set in the same update and `partial_text` is cleared.
  4. **Placement.** Only `manual_x` and `manual_y` change.

  Any other change raises. In particular, nothing can change `parent_id`, `kind`, `tree_id`,
  `anchor_*`, `requery_of` or `provenance`, so drags can never re-parent (FR-037).

**Derived values** (computed in queries and mappers, never stored; R5)

- **Edge state** (FR-006), for question edges:
  - `unsent` when `text IS NULL`.
  - Otherwise from the newest child answer's status: `pending` → `replying`, `complete` →
    `answered`, and `incomplete`, `stopped` or `failed` map to themselves.
  - A sent edge with no answer is `failed`.
- **Tree root**: the origin edge's earliest answer (FR-005).
- **Context path** for an answer: ancestors of its edge up to the origin (R6).
- **Output review**:
  - From the newest `output_reviews` row: `proposed` when there is none, otherwise `confirmed` or
    `rejected`.
  - A function edge is `rejected` when every one of its outputs is, `confirmed` when any is, and
    `proposed` otherwise. It is drawn tentative unless confirmed (FR-049).

### `edge_notes`

One short note per edge, kept as history (FR-040). This replaces Feature 2's edge labels.

| Column | Type | Rules |
|--------|------|-------|
| id | uuid PK | |
| edge_id | uuid NOT NULL → nodes | Must be shape `edge` (trigger). |
| text | text NULL CHECK length 1..200 | NULL clears the note. |
| provenance | provenance NOT NULL CHECK = 'user_authored' | |
| created_at | timestamptz NOT NULL DEFAULT clock_timestamp() | |

The newest row is the current note. The table is append-only, enforced by trigger.

### `output_reviews`

| Column | Type | Rules |
|--------|------|-------|
| id | uuid PK | |
| node_id | uuid NOT NULL → nodes | A function output (trigger checks `origin = 'run'` and shape `node`). |
| kind | text NOT NULL CHECK IN ('confirmed','rejected') | |
| provenance | provenance NOT NULL | CHECK confirmed → `user_confirmed`, rejected → `user_authored`. |
| created_at | timestamptz NOT NULL DEFAULT clock_timestamp() | |

Append-only, and the newest row wins (FR-050, FR-051).

### `kind_setting_changes` (recreated in `public`)

Same columns as Feature 9, but `node_id` references v2 `nodes` and holds the function edge an
override belongs to (FR-053). Append-only. Resolution order: the override on the edge, then the
kind-level value (`node_id IS NULL`), then the declared default.

### `parked_tangents` and `parked_tangent_events` (recreated in `public`)

Same semantics as Feature 8. `node_id` references v2 `nodes` (a content node or an edge), and the
offsets are on that element's `text`. `message_id` is gone. The `fired` event's `child_node_id` is
renamed `edge_id` and references the edge it created. Both tables are append-only, and at most one
terminal event exists per tangent.

### `project_cameras`

| Column | Type | Rules |
|--------|------|-------|
| project_id | uuid PK → projects | |
| x, y | real NOT NULL | World coordinates at the screen centre. |
| scale | real NOT NULL CHECK 0.02..4 | |
| updated_at | timestamptz NOT NULL | |

This is mutable presentation data, written after the camera has been idle for 500 ms (FR-028).

### `v1_conversion` (ledger)

| Column | Type | Rules |
|--------|------|-------|
| id | bigint identity PK | |
| v1_table | text NOT NULL | For example `messages`, `nodes`, `branch_markers`, `pipes`. |
| v1_id | uuid NOT NULL | |
| v2_id | uuid NULL | The v2 row it became. NULL when kept but not applied, such as conversation-level hand placements (research R4). |
| detail | jsonb NOT NULL DEFAULT '{}' | For example `{ "manual": {"x":…, "y":…} }`. |
| created_at | timestamptz NOT NULL DEFAULT clock_timestamp() | |

`UNIQUE (v1_table, v1_id, v2_id) NULLS NOT DISTINCT` gives idempotency. The table is append-only.

### `v1_checksums`

`(table_name text PK, row_count bigint, digest text, taken_at timestamptz)`. Taken at migration
start over every frozen table, ordered by id. `v1:verify` compares them later (SC-003).

## Changed live tables (additive only)

### `definitions`

- `ADD COLUMN source_id uuid REFERENCES nodes(id)`. This is the node or edge the term came from
  (FR-055).
- `source_node_id` and `source_message_id` become nullable and keep their v1 values. Old rows get
  `source_id` = `source_message_id`, which is now that element's id.
- `CHECK (source_id IS NOT NULL OR source_node_id IS NOT NULL)`.
- New captures set only `source_id`.

### `feedback_items`

- `ALTER TYPE feedback_view ADD VALUE 'canvas'`. It isn't used inside the same transaction.
- `ADD COLUMN project_id uuid REFERENCES projects(id)` and
  `ADD COLUMN element_id uuid REFERENCES nodes(id)`.
- The old check `feedback_items_node_only_in_chat` is replaced by
  `CHECK (node_id IS NULL OR view = 'chat')` and
  `CHECK (element_id IS NULL OR view IN ('chat','canvas'))`.
- Backfill for old rows:
  - `element_id` = the first edge of the v1 node's conversation, through the ledger.
  - `project_id` = that tree's project.
- After the backfill, `feedback_items_rank_only()` is replaced by a version that also freezes
  `project_id` and `element_id`.
- New feedback records `view = 'canvas'`, the open project and the focused element (FR-058).

## Kind declarations (data, `src/shared/kinds/`)

| Kind | Shape | Display | Settings | Accepts input kinds |
|------|-------|---------|----------|---------------------|
| `question` | edge | `question` (user bubble, Feature 7) | none | none |
| `answer` | node | `answer` (plain text, AI tag) | none (Feature 6 stays global) | none |
| `function` | edge | `function_connector` (labelled, directional, dashed until confirmed) | none | none |
| `analogy` | node | `output` (AI-tinted card) | `reach`, `length` (from Feature 9) | `answer` |

Function definitions live in `src/server/functions/definitions/`. Analogy v2 has `accepts: ["answer"]`,
`reads: "text"`, `outputKind: "analogy"` and `procedure: "propose"`.

## State transitions

```text
question edge:  (created unsent) ──send──▶ sent ─┬─ attempt pending ─▶ replying
                (created by ask/????/parked-with-question: sent at insert)
                                                 └─ newest attempt ends ─▶ answered | incomplete | stopped | failed
                any sent state ──retry/regenerate──▶ new attempt (sibling answer), earlier attempts unchanged

answer:  pending ──▶ complete | incomplete | stopped | failed      (written once; nodes_guard)
         pending with no live generator at read time ──▶ incomplete (orphan rule, Feature 2)

function output:  inserted complete ──▶ review: proposed ──confirm──▶ confirmed
                                                         └─reject──▶ rejected (hidden by default)
```

## Validation rules from requirements

- **Branch, Define and Park on a span (FR-016, FR-017).** The element is in a live (untrashed)
  project, and its text is final:
  - a sent question edge, or
  - an answer with `status = 'complete'`, or
  - a function output.

  The span satisfies `0 <= start < end <= length(text)` and `text[start:end]` equals the given
  text, which is not blank. A function output can anchor Define, but not Branch or Park (it is a
  leaf, research R12).
- **Ask (FR-010, FR-013).**
  - From a content node: answers only.
  - From an edge: allowed when the edge is sent and its newest attempt isn't `pending`. This is the
    "two user messages in a row" case.
  - Refused with `reply_in_progress` while the element's own newest answer is pending.
- **`????` (FR-020).** The focused element is an answer. Its edge has `origin <> 'origin'`, its
  kind is `question`, it has a parent, and no node has `requery_of` = that edge. Otherwise the text
  is sent as an ordinary message.
- **Retry.** The newest attempt of the edge is `incomplete`, `stopped` or `failed`.
- **Regenerate.** The edge has a `complete` attempt. This is allowed even when branches exist, and
  the branches stay on the original answer (FR-041, FR-042).
- **Run function (FR-047).** The node's kind is in the function's `accepts`, and both are in the
  same untrashed project.
- **Settings change (FR-053).** A declared key and an allowed value. It inserts history and never
  starts a run.
