# Data Model: Suggested Branch Underlines

## `span_suggestions` (new; migration `0005_span_suggestions.ts`)

This table is the hidden cache from FR-013. It isn't part of the user's structure: no other table
references it, no view joins it, and deleting every row loses nothing the user created.

| Column | Type | Notes |
|--------|------|-------|
| `message_id` | `uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE` | The analyzed AI message |
| `detector_version` | `integer NOT NULL` | `SPAN_DETECTOR_VERSION` at compute time (research R3) |
| `spans` | `jsonb NOT NULL` | `[{ "start": int, "end": int, "text": string }]`, validated and ordered, 0–3 items |
| `provenance` | `text NOT NULL DEFAULT 'ai_suggested' CHECK (provenance = 'ai_suggested')` | Always AI-suggested (Article I) |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |

- **Primary key**: `(message_id, detector_version)`.
- **Writes**: only `INSERT … ON CONFLICT DO NOTHING` from the suggestions queue. No code updates
  rows.
- **Validation rules** (from `locateSpans`, research R2), which apply before insert:
  - `0 ≤ start < end ≤ content.length`, and `content.slice(start, end) === text`
  - 2–20 words and at most 200 characters; no line break and no `` ` * [ ] < > | # ``
  - no two spans overlap; at most 3
- **Eligibility**: only messages with `role = 'ai'`, `status = 'complete'` and `replaced_at IS NULL`
  are analyzed (FR-003, FR-007). A message that later becomes replaced keeps its row, but the row
  is never read, because only live messages are listed.

## `SuggestedSpan` (shared type; never an entity of its own)

```ts
type SuggestedSpan = { start: number; end: number; text: string };
```

It has no id, provenance field or history on the client (Key Entities). It exists only to draw an
underline and to build a selection when clicked.

## Unchanged

`messages`, `branch_markers`, `nodes`, `definitions`, `node_summaries` and all other tables are
untouched. A click hands off to the existing Feature 1 and Feature 2 flows, which record exactly
what they already record (FR-006, FR-009).

## Client state

- **`settingsStore`** (new, zustand with `persist` to `localStorage["farabi.settings"]`):
  `{ showSuggestions: boolean }`, default `true`.
- **ChatView** keeps `suggestions: Map<messageId, SuggestedSpan[]>` for the open node, in memory
  only.
