# Data Model: In-App Feedback Loop

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-09-27

A single forward-only migration, `src/server/db/migrations/0003_feedback.ts`, adds four tables, two
enums and the append-only triggers. No existing table changes. Existing `provenance` enum values
are reused.

## Enums

```text
feedback_view  = 'chat' | 'map' | 'definitions'           -- research R2
feedback_state = 'open' | 'addressed' | 'resolved'
```

## feedback_items

One piece of feedback. Its current state is **not** stored here; it is the latest
`feedback_state_events` row (R8).

| Column | Type | Rules |
|--------|------|-------|
| `id` | uuid PK, `gen_random_uuid()` | |
| `text` | text NOT NULL | `CHECK (length(btrim(text)) > 0 AND length(text) <= 20000)` (FR-003) |
| `view` | feedback_view NOT NULL | FR-006 |
| `node_id` | uuid NULL → `nodes(id)` ON DELETE RESTRICT | `CHECK (node_id IS NULL OR view = 'chat')`; absent, not a placeholder, when no node is open |
| `rank` | text NULL, `COLLATE "C"` | Set only by a drag (R3). NULL = default order |
| `provenance` | provenance NOT NULL | `CHECK (provenance = 'user_authored')` |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

- **Effective sort key** (R3): `COALESCE(rank, lpad(floor(extract(epoch FROM created_at) * 1000)::bigint::text, 15, '0'))`.
  The list orders by that key descending, then `id` descending.
- **Trigger**: DELETE raises. UPDATE raises unless every column except `rank` is unchanged.
- **Index**: `(created_at DESC)`.

## feedback_tags

| Column | Type | Rules |
|--------|------|-------|
| `id` | uuid PK | |
| `item_id` | uuid NOT NULL → `feedback_items(id)` ON DELETE RESTRICT | |
| `text` | text NOT NULL | as typed, trimmed; `CHECK (length(text) BETWEEN 1 AND 60)` |
| `tag_key` | text NOT NULL | `termKey(text)` (R4) |
| `provenance` | provenance NOT NULL | `CHECK (provenance = 'user_authored')` |
| `created_at` | timestamptz NOT NULL DEFAULT `clock_timestamp()` | rows are inserted one at a time, so this keeps the order typed |

- `UNIQUE (item_id, tag_key)`: the same tag twice on one item is stored once.
- Index `(tag_key)`.
- **Trigger**: UPDATE and DELETE raise.

## feedback_attachments

| Column | Type | Rules |
|--------|------|-------|
| `id` | uuid PK | also the file's base name |
| `item_id` | uuid NOT NULL → `feedback_items(id)` ON DELETE RESTRICT | |
| `file_path` | text NOT NULL UNIQUE | relative to `FEEDBACK_DIR`: `attachments/<itemId>/<id>.<ext>` |
| `thumb_path` | text NULL | `attachments/<itemId>/<id>.thumb.webp`; NULL if the browser sent none |
| `original_name` | text NULL | the pasted or dropped file's name, when there is one |
| `mime_type` | text NOT NULL | `CHECK (mime_type IN ('image/png','image/jpeg','image/webp','image/gif'))` |
| `byte_size` | integer NOT NULL | `CHECK (byte_size BETWEEN 1 AND 10485760)` |
| `sha256` | text NOT NULL | checksum of the stored file, so FR-023 ("unchanged") is checkable |
| `provenance` | provenance NOT NULL | `CHECK (provenance = 'user_authored')` |
| `created_at` | timestamptz NOT NULL DEFAULT `clock_timestamp()` | keeps paste order, as for tags |

- At most 10 per item, enforced in the service, since a check constraint cannot count rows.
- **Trigger**: UPDATE and DELETE raise.

## feedback_state_events

The append-only state history (FR-016).

| Column | Type | Rules |
|--------|------|-------|
| `id` | uuid PK | |
| `item_id` | uuid NOT NULL → `feedback_items(id)` ON DELETE RESTRICT | |
| `state` | feedback_state NOT NULL | |
| `provenance` | provenance NOT NULL | see the check below |
| `created_at` | timestamptz NOT NULL DEFAULT `clock_timestamp()` | R8 |

- `CHECK ((state = 'open' AND provenance = 'user_authored') OR (state = 'addressed' AND provenance = 'ai_suggested') OR (state = 'resolved' AND provenance = 'user_confirmed'))`.
  This ties each state to who may set it (FR-013, FR-026).
- Index `(item_id, created_at DESC)`. The current state is the first row of that index.
- **Trigger**: UPDATE and DELETE raise.

## State machine

```text
            create (user_authored)
                    │
                    ▼
   ┌──────────►  open  ───────────────┐
   │  reopen       │  script only      │ user resolves directly (FR-014)
   │ (user)        ▼  (ai_suggested)   │
   ├────────── addressed ──────────────┤
   │                                   ▼
   └───────────────────────────── resolved (user_confirmed)
```

Transitions are validated in `src/server/feedback/state.ts` with the item row locked
(`FOR UPDATE`). The full table is in research R9. Invalid transitions change nothing.

## Files on disk (`FEEDBACK_DIR`, default `<repo>/feedback/`)

```text
feedback/
├── FEEDBACK.md                         # regenerated, never hand-edited (contracts/feedback-file.md)
└── attachments/
    └── <itemId>/
        ├── <attachmentId>.png          # original, written once with the 'wx' flag
        └── <attachmentId>.thumb.webp   # optional thumbnail
```

The database is canonical for everything except image bytes, which live only on disk. Their
integrity is recorded by `sha256`.

## TypeScript shapes

Additions to `src/server/db/schema.ts`:

- `FeedbackItemsTable`, `FeedbackTagsTable`, `FeedbackAttachmentsTable` and
  `FeedbackStateEventsTable`, following the existing table interfaces;
- the `FeedbackView` and `FeedbackState` union types.

The API-facing `FeedbackItem` shape is in [contracts/http-api.md](./contracts/http-api.md) and goes
in `src/shared/schemas.ts`.
