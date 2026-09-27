# Research: In-App Feedback Loop

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-09-27

The stack is unchanged from Features 1 and 2 (`specs/001-branching-chat-map/research.md`,
`specs/002-map-definitions-streaming/research.md`). These notes cover only what this feature adds.
No new runtime dependency is needed.

## R1. Where the panel lives (FR-001, FR-002, FR-007)

- **Decision**: A **Feedback** button in the existing top bar (`src/app/layout.tsx`) opens a
  right-side drawer that overlays whatever page is showing. The drawer holds the compose form at the
  top and the item list below it. It is a client component mounted once in the root layout, next to
  `MapHost`, so it survives navigation and never changes the URL. `Esc` closes it; the draft
  (text, tags, pasted images) stays in memory while the drawer is closed.
- **Rationale**: The top bar is already on every page (chat, map, definitions), so SC-001 holds for
  free. A drawer, not a route, means opening it never navigates away (FR-002). The map canvas stays
  mounted underneath, so closing the drawer returns to exactly the same map state.
- **Alternatives considered**: a `/feedback` page (breaks FR-002); a separate floating button (a
  second piece of global chrome for no gain); a modal dialog (blocks seeing the thing being
  described while typing).

## R2. Capturing context (FR-006)

- **Decision**: Context comes from the current pathname when the item is submitted:
  `/n/{nodeId}` → view `chat` with that node id; `/` (new conversation) → view `chat`, no node;
  `/map` → view `map`, no node; `/definitions` → view `definitions`, no node.
- **Rationale**: The spec names chat and map. Feature 2 added a Definitions tab, which is also a
  view someone can give feedback from, so it is recorded as its own view instead of being forced
  into one of the two. Anything else the router later adds falls back to `chat` with no node, which
  the enum can grow to cover in a later migration.
- **Storage**: the node id is a foreign key to `nodes` (nodes are never deleted), so it can never
  point at nothing.

## R3. Manual order without moving untouched items (FR-008, FR-009, SC-006)

- **Decision**: Every item has an **effective sort key**, and the list shows keys in descending
  order:
  - an item nobody has dragged uses a key derived from its creation time: its epoch milliseconds,
    zero-padded to 15 digits;
  - a dragged item stores its own `rank` key, chosen to fall strictly between the effective keys of
    the two items it was dropped between.

  Keys are decimal strings compared byte-wise (`COLLATE "C"`). `keyBetween(lo, hi)` builds a string
  strictly between two keys by extending the fractional digits, so the space never runs out. It
  never needs to rewrite a neighbour.
- **Why it meets the spec**: dragging writes one row, the dragged item's. Untouched items keep their
  creation-time keys, so their stored positions never change (SC-006). A new item's creation time is
  larger than every older one, so it appears at the top by default without disturbing manual
  positions (edge case). A tag filter only hides rows, so clearing it shows the same order (US2-AS5).
- **Drop at the ends**: dropping at the top uses a key just above the top item's key; dropping at
  the bottom uses one just below the last item's key.
- **Filtered drags**: the neighbours are the items visible on either side of the drop. The item
  lands between them in the full list, possibly next to hidden items, which is fine.
- **Ties**: two untouched items created in the same millisecond share a key and are separated by
  id. Dropping between them places the item immediately above both. This is acceptable and noted.
- **Alternatives considered**:
  - A `double precision` midpoint runs out of precision after roughly 30 drops into the same gap.
  - Renumbering the whole list on each drag violates SC-006.
  - A linked list (`after_id`) makes reads and filters awkward.
- **History**: `rank` is overwritten, the same way Feature 2 overwrites hand-placed node positions.
  Order is a display preference, not a state transition, so FR-016 does not apply to it.

## R4. Tags (FR-004, FR-010)

- **Decision**: Tags are stored per item with their text as typed and a `tag_key` built with
  Feature 2's `termKey()` (trim, collapse whitespace, lowercase, NFC). A tag typed twice on one item
  is kept once (unique `(item_id, tag_key)`). The filter is one tag at a time, chosen from chips
  that list every tag key in use with a count. It is applied in the browser, since the panel already
  holds every item.
- **Spec gap, resolved**: FR-004 allows tags only at submission, while FR-017 lists "a tag change"
  as a write. In v1, **tags and attachments are added only at submission**. Nothing can be removed
  (FR-024), so an edit UI for tags would have to be add-only, and nothing in the stories needs it.
  FR-017's "tag change" trigger therefore never fires in v1, and regeneration still runs on every
  write that does exist. Adding tags after submission can be a later, additive change.

## R5. Screenshots: upload, storage, thumbnails (FR-005, FR-022, FR-023, SC-008)

- **Decision**:
  - The form accepts images from paste (`clipboardData.files`) and drop (`dataTransfer.files`).
  - Accepted types are PNG, JPEG, WebP and GIF, checked by magic bytes on the server, not just by
    the declared type.
  - Limits: **10 MB per image, 10 images per item**. Both are enforced in the form and again on the
    server (`422`). Size and count limits were left to planning.
  - The browser makes a thumbnail before upload (`createImageBitmap` → canvas → WebP, 320 px on the
    long side) and sends it with the original. `POST /api/feedback` is one `multipart/form-data`
    request read with `request.formData()`.
  - Files are written to `<FEEDBACK_DIR>/attachments/<itemId>/<attachmentId>.<ext>` plus
    `<attachmentId>.thumb.webp`, opened with the `wx` flag so an existing file can never be
    overwritten (FR-022). The database keeps metadata: relative path, type, size and SHA-256.
- **Rationale**: Thumbnails keep a 200-item panel light (SC-008) with no server image library. The
  images also get `loading="lazy"`, and cards get `content-visibility: auto`. Next.js 16 route
  handlers have no body limit without a proxy (checked in
  `node_modules/next/dist/docs/.../proxyClientMaxBodySize.md`; this project has no `proxy.ts`), so
  the limits are ours to enforce.
- **Atomicity**: files are written inside the create transaction, before commit. If the
  transaction fails, the files just written are removed. Nothing was committed, so no feedback data
  is deleted.
- **Serving**: `GET /api/feedback/attachments/{id}` streams the original and `?thumb=1` streams the
  thumbnail, falling back to the original if no thumbnail exists. Clicking a thumbnail opens a
  full-size lightbox inside the drawer.
- **Alternatives considered**: `sharp` on the server (a new native dependency); storing images as
  `bytea` in Postgres (Claude Code could not open them from disk, which breaks US5-AS4).

## R6. The file Claude Code reads (FR-017, FR-018, SC-004)

- **Decision**: `<FEEDBACK_DIR>/FEEDBACK.md`, where `FEEDBACK_DIR` defaults to `feedback/` at the
  repo root. It is Markdown, like `tasks.md`, and generated in full from the database each time
  (format in [contracts/feedback-file.md](./contracts/feedback-file.md)):
  - a short header: what the file is, that it is generated, and the exact command to mark an item
    addressed;
  - sections **Open** (in panel order), **Addressed**, and **Resolved**;
  - per item: id, state, capture time, view, node id with its current map label, tags, attachment
    paths relative to the repo root, the full state history, and the text as a blockquote. The
    blockquote keeps user-written Markdown from breaking the file's structure.
- **Regeneration**: every service function that writes feedback data calls
  `regenerateFeedbackFile()` after its transaction commits. It takes a Postgres advisory lock,
  reads everything, writes `FEEDBACK.md.tmp`, and `rename`s it over the old file. The rename is
  atomic, so a reader never sees half a file, and a failed write leaves the previous file in place
  (edge case). The lock stops the app and the script from racing and leaving an older snapshot
  last. A failure is logged and never fails the user's request, because the database is the source
  of truth. The file is also regenerated when the server starts and on demand with
  `npm run feedback:export`. For server start, `src/instrumentation.ts` `register()` runs only when
  `NEXT_RUNTIME === "nodejs"` and imports the exporter dynamically, as the bundled Next.js
  instrumentation docs describe.
- **Timing**: one full write for 200+ items takes milliseconds, well inside SC-004's 1 s.
- **Discovery**: a short section in `CLAUDE.md` (outside the Next.js-managed `AGENTS.md` block)
  tells Claude Code where the file is and how to use the script.

## R7. The "addressed" script (FR-019, FR-020, SC-007)

- **Decision**: `npm run feedback:addressed -- <item-id>` runs `tsx scripts/feedback-addressed.ts`.
  It loads `.env.local` like the other scripts, connects to Postgres, and calls exactly one domain
  function, `markAddressed(id)`. That function:
  1. locks the item row (`SELECT … FOR UPDATE`);
  2. reads the latest state event;
  3. if the item is `open`, inserts one `addressed` / `ai_suggested` event;
  4. otherwise changes nothing.

  After a change, the script regenerates the file. Exit codes: `0` addressed; `2` not open, no
  change; `3` no such item; `1` any other error (including a malformed id). It accepts nothing but
  one id, and has no flags for state or text.
- **Why direct database access, not the app's HTTP API**: Claude Code usually works while the dev
  server is stopped. The script needs only the Docker Postgres that `npm run dev` also needs. "No
  credentials" in the spec means Claude Code never handles them: the script reads the same local
  `.env.local` every project script reads.
- **Enforcement, stated honestly**:
  - The script's narrowness (FR-020) is enforced by its code and by database triggers (R8).
  - It is not an OS-level sandbox. Claude Code has a shell and could in principle run `psql`.
  - The `CLAUDE.md` instructions say to use only the script. The triggers make the forbidden edits
    (text, tags, attachments, history, deletes) impossible for any client, not just the script.
- **Alternatives considered**: an HTTP endpoint the script calls (needs the app running); letting
  Claude Code edit `FEEDBACK.md` and syncing it back (turns a derived file into a second source of
  truth).

## R8. Append-only guarantees in the database (FR-016, FR-020, FR-024, SC-005, SC-007)

- **Decision**: The migration adds `BEFORE UPDATE OR DELETE` triggers:
  - `feedback_state_events`, `feedback_tags`, `feedback_attachments`: any `UPDATE` or `DELETE`
    raises an error.
  - `feedback_items`: `DELETE` raises; `UPDATE` raises unless only `rank` changed.
- **Rationale**: Features 1 and 2 enforce Article II with code guards and tests only. Here, a second
  writer (the script) runs outside the app, so a database-level guard is worth its few lines. It
  also makes SC-007 checkable directly. `TRUNCATE` does not fire row triggers, so test setup can
  still reset tables.
- **State ordering**: state events default `created_at` to `clock_timestamp()` rather than
  `now()`, so two transitions made quickly in sequence always sort correctly. The latest event is
  the current state.

## R9. State transitions (FR-012 – FR-015)

| From → To | Who | Provenance of the new event | Allowed |
|-----------|-----|------------------------------|---------|
| (create) → `open` | user, in app | `user_authored` | yes |
| `open` → `addressed` | Claude Code script | `ai_suggested` | yes |
| `open` → `resolved` | user, in app | `user_confirmed` | yes (FR-014) |
| `addressed` → `resolved` | user, in app | `user_confirmed` | yes |
| `addressed` → `open` | user, in app (reopen) | `user_authored` | yes (FR-015) |
| `resolved` → `open` | user, in app (reopen) | `user_authored` | yes (FR-015) |
| anything else | anyone | — | rejected: `409` in app, exit code `2` in script |

The app has no endpoint that sets `addressed`, and the script has no path to any other state. The
UI shows an `addressed` item as **"Claude Code says done — confirm?"**, visually distinct from
`resolved`, so an AI suggestion never looks like a confirmation (Article I).

## R10. Drag to reorder in the list

- **Decision**: Reordering uses pointer events on a drag handle (no library). A drop line shows the
  target gap, and on drop the client sends the visible neighbours (`aboveId`, `belowId`). The client
  reorders optimistically and rolls back if the request fails. For keyboard use, `Alt+↑` / `Alt+↓`
  on a focused card moves it one place through the same endpoint.
- **Rationale**: The project already hand-rolls map dragging with pointer events. One vertical list
  does not justify a drag-and-drop dependency.

## R11. Test isolation

- **Decision**: Tests set `FEEDBACK_DIR` to a temporary folder:
  - integration: a per-run temp folder, set in `tests/integration/setup.ts`;
  - e2e: `.feedback-test/`, set in the Playwright `webServer.env` and git-ignored.

  Integration setup also truncates the four feedback tables. The script is tested by running its
  exported function and, in one test, the real `tsx` process against the test database.
