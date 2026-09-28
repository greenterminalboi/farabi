# Data Model: Branch Queue

Migration `src/server/db/migrations/0007_parked_tangents.ts` is forward-only. It adds two
tables. No existing table changes.

## `parked_tangents` (insert-only)

| Column | Type | Rules |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `node_id` | uuid NOT NULL → `nodes(id)` | The node the tangent was parked from. It is shown only under this node. |
| `message_id` | uuid NOT NULL → `messages(id)` | Must belong to `node_id`, be `complete`, and not be replaced when parked. |
| `start_offset`, `end_offset` | integer NOT NULL | `0 ≤ start < end ≤ length(message.content)`, checked in the service as in `createBranch` |
| `anchor_text` | text NOT NULL | Equals `content[start:end]`. Not whitespace-only. |
| `prefix`, `suffix` | text NOT NULL | Up to 32 characters of context on each side, as `branch_markers` stores them |
| `provenance` | provenance NOT NULL | DEFAULT and CHECK `= 'user_authored'` (Article I: parking is never AI-suggested) |
| `created_at` | timestamptz NOT NULL | `now()` |

- Index `parked_tangents_by_node (node_id, created_at DESC, id DESC)`.
- Index `parked_tangents_by_message (message_id)`, used by the regenerate guard (research R6).
- Trigger `parked_append_only` rejects every UPDATE and DELETE. `SELECT … FOR UPDATE` is still
  allowed and is used to serialize actions on one tangent.

## `parked_tangent_events` (append-only)

| Column | Type | Rules |
|--------|------|-------|
| `id` | uuid PK | |
| `tangent_id` | uuid NOT NULL → `parked_tangents(id)` | |
| `kind` | text NOT NULL | One of `question_set`, `discarded`, `fired` |
| `question` | text NULL | Allowed only when `kind = 'question_set'`. NULL clears the question. When set, it can't be whitespace-only: `btrim(question) <> ''`. Stored exactly as typed, not trimmed (FR-012 "unchanged"). |
| `child_node_id` | uuid NULL → `nodes(id)` | Required when `kind = 'fired'` and NULL otherwise |
| `provenance` | provenance NOT NULL | DEFAULT and CHECK `= 'user_authored'` |
| `created_at` | timestamptz NOT NULL | |

- Index `parked_events_latest (tangent_id, created_at DESC, id DESC)`.
- Unique partial index `parked_events_terminal ON (tangent_id) WHERE kind IN ('discarded',
  'fired')`. Each tangent ends at most once, so it can create at most one branch (FR-014,
  double-click edge case).
- The same `parked_append_only` trigger applies.

## Derived state

```text
question(t) = question of t's latest question_set event, or null if there is none
status(t)   = 'fired'     if a fired event exists
              'discarded' if a discarded event exists
              'live'      otherwise
```

The Parked tab lists `status = 'live'` items for the open node (FR-003). Only this module
computes status: `src/server/parked/state.ts`.

## State transitions

```text
            park (question?)                                         ┌─► fired      (terminal)
  (none) ──────────────────► live ──┬── set question (text | null) ──┤
                                    │        (loops back to live)    └─► discarded  (terminal)
                                    ├── fire ──────────────────────────► fired
                                    └── discard ───────────────────────► discarded
```

| Action | Allowed from | Writes | Error when not live |
|--------|--------------|--------|---------------------|
| Park | none | a tangent row, plus a `question_set` event if a non-blank question was given | – |
| Set question | live | a `question_set` event, with the question or null. Nothing is written when it equals the current question. | 409 `parked_consumed` |
| Discard | live | a `discarded` event | 409 `parked_consumed` |
| Fire | live | a node and a `selection` branch marker (via `insertBranch`); with a question, also a user message and a pending AI reply (via `insertUserTurn`); then a `fired` event with `child_node_id`. All in one transaction (research R2). | 409 `parked_consumed` |

Whitespace-only question input becomes NULL in the service before the insert (FR-011, US1-4).

## Validation shared with Branch

`validateAnchor(trx, nodeId, anchor)` is extracted from `createBranch`. It checks:

- the message belongs to the node, is `complete` and has not been replaced
- the offsets are in range
- the text is not whitespace-only
- `content.slice(start, end) === text`

Park runs it at park time and fire runs it again. Research R6 makes it pass at fire time: a reply
with live parked items can't be regenerated, so its anchor message is never replaced while an
item is live.

## Changes to existing behavior

- **`canRegenerate`** (`nodeView.ts`) and `regenerate.ts` also treat live parked items on the
  latest reply as blocking. The error is 409 `has_parked` (research R6).
- **No other table is touched.** Parking, editing and discarding write only to the two tables
  above (FR-017).

## Constitution guards

These are added to `tests/integration/constitution.test.ts`:

1. Every `parked_tangents` and `parked_tangent_events` row is `user_authored` (Article I).
2. No `updateTable` or `deleteFrom` touches either table, and a raw UPDATE or DELETE is rejected
   by the trigger (Articles II and VI).
3. Only these files reference `parked_`:
   - `src/server/parked/`
   - `src/server/forest/nodeView.ts`
   - `src/server/messages/regenerate.ts`
   - `src/server/db/`

   `src/server/ai`, `src/server/summaries`, `src/server/suggestions`,
   `src/server/messages/replyInput.ts` and `src/server/forest/forest.ts` never do. This keeps
   parked questions away from the AI and off the map (research R9).
4. The existing guard against DELETE and PATCH handlers still passes. The new routes are all
   POST.
