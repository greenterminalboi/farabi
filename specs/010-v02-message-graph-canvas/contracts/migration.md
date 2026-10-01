# Migration Contract: v1 Conversations → v2 Graph

Implements FR-063 to FR-067 and SC-001 to SC-003. Code:

- `src/server/db/migrations/0010_message_graph.ts`: schema changes, then a call to the converter
- `src/server/db/v1/convert.ts`: the converter. It is frozen once shipped, and the only code
  allowed to read `v1`.
- `src/server/db/v1/verify.ts`
- `scripts/migrate.ts` (backup step), `scripts/v1-convert.ts`, `scripts/v1-verify.ts`

## Order inside the migration transaction

1. `CREATE SCHEMA v1`. Move the twelve tables (data-model.md) into it, then add the `v1_frozen`
   triggers.
2. Record `v1_checksums`: the row count plus `md5(string_agg(row_to_json(t)::text, '' ORDER BY id))`
   for each table. Tables without an `id` column use their primary key.
3. Create the v2 tables, triggers and indexes. Apply the additive changes to `definitions` and
   `feedback_items`.
4. Run `convertV1(trx)`.
5. Backfill `definitions.source_id`, then `feedback_items.element_id` and `project_id`. Replace
   `feedback_items_rank_only()`.
6. Print the report (counts per rule below).

Any error rolls back the whole transaction. A rerun starts from the unchanged database.

## Conversion rules (`convertV1`)

Every insert is `ON CONFLICT DO NOTHING`, and every rule appends to `v1_conversion`.

| v1 source | v2 result | Id |
|-----------|-----------|----|
| `v1.trees` row | `trees` row: same project, origin and `user_placed` | same id |
| first user message of a root conversation | `question` edge, origin `origin`, parent null | message id |
| first user message of a branch conversation (marker `selection`) | `question` edge, origin `branch` (or `parked` when a `fired` parked event names this conversation), parent = the element holding the marker's message (that message's id), anchor = the marker's offsets, text, prefix and suffix | message id |
| first user message of a quick-branch conversation (marker `whole_message`) | `question` edge, origin `quick_branch`, parent = the v2 parent of the re-asked edge, `requery_of` = the marker's message id | message id |
| a later user message | `question` edge, origin `ask`. Parent: the newest *complete* answer after the previous user message in the conversation, else the previous user message's edge. | message id |
| an AI message (live or replaced) | `answer`, parent = the edge of the user message it follows. Status, text, `partial_content`, pressure and model are copied. Origin is `reply` for the first attempt under that edge. A row that replaced a complete row is `regenerate`, and one that replaced an incomplete, stopped or failed row is `retry`. | message id |
| a branch conversation with no messages | `question` edge, unsent (text null), origin `branch` or `parked`, parent and anchor as above | v1 node id |
| `v1.edge_label_versions` rows (all versions, in order) | `edge_notes` rows on the conversation's first edge | new id; ledger entry per version |
| `v1.nodes.manual_x/y` of a conversation | ledger entry only (`v2_id` NULL, `detail.manual`), not applied (research R4) | n/a |
| `v1.nodes.manual_x/y` of a 009 output | `manual_x/y` on its v2 output | n/a |
| `v1.parked_tangents` | `parked_tangents` on the element whose id is the tangent's `message_id`, same offsets | same id |
| `v1.parked_tangent_events` | `parked_tangent_events`. `fired.child_node_id` maps to that conversation's first edge. | same id |
| `v1.pipes` and `v1` pipe node | `function` edge, origin `run`. Parent = the answer whose id is the `through_message_id` of the summary named by the first output version's `source_version`. Function id and version are copied. | pipe node id |
| `v1.function_output_versions` (per output, oldest first) | one `analogy` output per version under that edge, `ai_suggested`, its text | first: v1 output node id. Later: derived id. |
| `v1.function_output_events` | `output_reviews`. `confirmed` goes to the output made from `version_id`, `rejected` to every output of that v1 node. | same id (first), derived (others) |
| `v1.kind_setting_changes` | `kind_setting_changes`. Kind-level rows as they are. Overrides on a v1 output move to its function edge. | same id |
| `v1.node_summaries` | none (summaries are off, FR-062). They are kept in `v1`. | n/a |

**Times.** `created_at` is copied from the v1 row for every converted element. An edge's `sent_at`
is its message's `created_at`. Derived rows use their source row's time.

**Derived ids** are `md5('<v1_table>:<v1_id>:<n>')::uuid`. They are stable across reruns.

## Invariants checked by `v1:verify` (and by the integration test on fixtures)

1. **Text reproduction (SC-001).** For each v1 conversation, take its live messages in `seq` order.
   Build the v2 sequence: start at the conversation's first edge and repeatedly take the
   conversation's next converted element. The `(role, text, created_at)` lists match exactly. A
   replaced message appears as a sibling attempt and never on the main path.
2. **Reply context unchanged.** For every complete v1 AI reply, `buildReplyInput` on the v2 answer
   produces the same ordered turns as v1's inherited context plus own messages (after the
   quick-branch cut).
3. **Counts (SC-002).** These are equal on both sides:
   - selection markers and anchored edges
   - quick-branch markers and edges with `requery_of`
   - definitions with a resolvable `source_id`
   - parked tangents and their events
   - edge-label versions and edge notes
   - placed trees and converted tree placements
   - conversation hand placements and ledger `detail.manual` entries
   - feedback items with a node and items with `element_id`
   - trees per project
4. **Original data unchanged (SC-003).** The current `v1` checksums equal `v1_checksums`.
5. **Rerun is a no-op.** Running `convertV1` again inserts 0 rows.

## Fixture coverage (integration test `tests/integration/v1-convert.test.ts`)

The fixture is seeded directly into `v1.*`. It contains:

- a root conversation with 3 exchanges
- a selection branch anchored on an answer
- a selection branch anchored on a user message
- a quick branch
- an empty branch
- a parked tangent, fired with a question
- a live parked tangent
- a regenerated reply and a retried failed reply
- a user message after a stopped reply
- edge labels with 2 versions
- 2 definitions
- feedback with and without a node
- a 009 Analogy with 2 versions, one confirmed
- a kind-level setting and an override
- a hand-placed tree and a hand-placed conversation
- a trashed project

Each invariant above is asserted, and so are the exact parents, origins and anchors of every
converted element.
