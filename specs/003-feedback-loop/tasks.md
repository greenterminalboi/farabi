---
description: "Task list for In-App Feedback Loop"
---

# Tasks: In-App Feedback Loop

**Input**: Design documents from `/specs/003-feedback-loop/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/http-api.md,
contracts/feedback-file.md, quickstart.md; Features 1 and 2 code on `main`

**Tests**: Included, as in Features 1 and 2. quickstart.md asks for a Playwright test per scenario,
and the ordering, state-machine and append-only rules need automated checks. Feature 3 test files
are prefixed `f3-`.

**Organization**: Tasks are grouped by user story (US1–US5 from spec.md).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to
- Paths are relative to the repository root

## Conventions for every task

- Follow the existing conventions:
  - domain logic lives in `src/server/feedback/` with no `next/*` imports, so the scripts can call it;
  - route handlers stay thin and are wrapped in `withApi`;
  - shared Zod schemas go in `src/shared/schemas.ts`;
  - the typed client is `src/lib/api.ts`.
- Never add DELETE or PATCH handlers. Never UPDATE any feedback column other than
  `feedback_items.rank`. Never import `src/server/ai` from feedback code (FR-021).
- Every service function that commits a feedback write calls `regenerateFeedbackFile()` after the
  commit, awaits it, and only logs if it fails (research R6).
- Error codes: `invalid_request` (422), `not_found` (404) and `invalid_transition` (409).

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Create migration `src/server/db/migrations/0003_feedback.ts` per data-model.md:
  - **Enums**: `CREATE TYPE feedback_view AS ENUM ('chat','map','definitions')` and
    `CREATE TYPE feedback_state AS ENUM ('open','addressed','resolved')`.
  - **`feedback_items`**:
    - `id uuid PK DEFAULT gen_random_uuid()`
    - `text text NOT NULL CHECK (length(btrim(text)) > 0 AND length(text) <= 20000)`
    - `view feedback_view NOT NULL`
    - `node_id uuid NULL REFERENCES nodes(id) ON DELETE RESTRICT` with
      `CHECK (node_id IS NULL OR view = 'chat')`
    - `rank text COLLATE "C" NULL`
    - `provenance provenance NOT NULL CHECK (provenance = 'user_authored')`
    - `created_at timestamptz NOT NULL DEFAULT now()`
    - index `(created_at DESC)`
  - **`feedback_tags`**:
    - `id`, `item_id` FK `feedback_items` `ON DELETE RESTRICT`
    - `text text NOT NULL CHECK (length(text) BETWEEN 1 AND 60)`
    - `tag_key text NOT NULL`
    - `provenance CHECK (provenance = 'user_authored')`, `created_at`
    - `UNIQUE (item_id, tag_key)`, index `(tag_key)`
  - **`feedback_attachments`**:
    - `id`, `item_id` FK `ON DELETE RESTRICT`
    - `file_path text NOT NULL UNIQUE`, `thumb_path text NULL`, `original_name text NULL`
    - `mime_type text NOT NULL CHECK (mime_type IN ('image/png','image/jpeg','image/webp','image/gif'))`
    - `byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760)`
    - `sha256 text NOT NULL`
    - `provenance CHECK (provenance = 'user_authored')`, `created_at`
  - **`feedback_state_events`**:
    - `id`, `item_id` FK `ON DELETE RESTRICT`
    - `state feedback_state NOT NULL`, `provenance provenance NOT NULL`
    - `created_at timestamptz NOT NULL DEFAULT clock_timestamp()`
    - `CHECK ((state = 'open' AND provenance = 'user_authored') OR (state = 'addressed' AND provenance = 'ai_suggested') OR (state = 'resolved' AND provenance = 'user_confirmed'))`
    - index `(item_id, created_at DESC)`
  - **Triggers** (plpgsql `BEFORE UPDATE OR DELETE ... FOR EACH ROW`):
    - raise on any UPDATE or DELETE of `feedback_state_events`, `feedback_tags` and
      `feedback_attachments`;
    - on `feedback_items`, raise on DELETE, and raise on UPDATE unless
      `(NEW.id, NEW.text, NEW.view, NEW.node_id, NEW.provenance, NEW.created_at)` equals the same
      tuple from OLD.
  - `down()` throws "Migrations are forward-only", as in `0002_workspace.ts`.
- [X] T002 Add `FeedbackView`, `FeedbackState` and the four table interfaces to
  `src/server/db/schema.ts`, following the existing interfaces (`Generated` for ids and
  `created_at`, `CreatedAt` column type). Register them in `Database`. Then run `npm run db:migrate`
  and `npx tsx scripts/migrate.ts --test`.
- [X] T003 [P] Add `/feedback/` and `/.feedback-test/` (anchored to the repo root) to `.gitignore`. Add
  `"feedback:addressed": "tsx scripts/feedback-addressed.ts"` and
  `"feedback:export": "tsx scripts/feedback-export.ts"` to `package.json` scripts. Add a commented
  `# FEEDBACK_DIR=feedback` line with an explanation to `.env.example`.
- [X] T004 [P] Set `FEEDBACK_DIR: ".feedback-test"` in `playwright.config.ts` `webServer.env`. In
  `tests/integration/setup.ts`:
  - set `process.env.FEEDBACK_DIR` to a fresh `fs.mkdtempSync(os.tmpdir() + "/farabi-feedback-")`
    before the dynamic imports;
  - add `feedback_state_events, feedback_attachments, feedback_tags, feedback_items` to the
    `TRUNCATE` list, before `nodes`. Row triggers do not fire on TRUNCATE.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T005 Add the shared shapes to `src/shared/schemas.ts`, exactly as in contracts/http-api.md
  "Shared shapes":
  - `FeedbackState`, `FeedbackView`, `FeedbackStateEvent`, `FeedbackAttachment`, `FeedbackItem`;
  - `FeedbackListResponse { items }` and `FeedbackItemResponse { item }`;
  - `FeedbackPositionRequest { aboveId: uuid | null, belowId: uuid | null }`;
  - `FeedbackCreateFields`, with `text` trimmed non-empty and at most 20000 characters, `view`,
    optional `nodeId` uuid, and `tags` as an array of strings of 1–60 characters after trimming.
- [X] T006 [P] Create `src/server/feedback/paths.ts`:
  - `feedbackDir()` resolves `process.env.FEEDBACK_DIR`, relative to the repo root, defaulting to
    `<repo>/feedback`, where the repo root is `path.resolve(import.meta.dirname, "../../..")`;
  - `feedbackFilePath()` returns `<dir>/FEEDBACK.md`;
  - `attachmentAbsPath(rel)` resolves a stored path;
  - `repoRelative(abs)` returns a path relative to the repo root when inside it, else absolute.

  Create folders lazily with `mkdir -p`.
- [X] T007 [P] Create `src/server/feedback/rankKey.ts` (research R3):
  - `createdAtKey(date)` returns the epoch milliseconds zero-padded to 15 digits;
  - `effectiveKey(item)` returns `item.rank ?? createdAtKey(item.created_at)`;
  - `keyBetween(lo: string | null, hi: string | null)` returns a decimal string strictly between two
    keys under byte-wise comparison, with a fixed 15-digit integer part and unbounded fractional
    digits:
    - `lo = null` means "below everything": return `hi` minus 1 at the integer part;
    - `hi = null` means "above everything": return `lo` plus 1 at the integer part;
    - equal keys: return `lo + "5"`, just above both (the documented tie rule).
  - Also export `SQL_EFFECTIVE_KEY`, a Kysely `sql` fragment
    `COALESCE(rank, lpad(floor(extract(epoch FROM created_at) * 1000)::bigint::text, 15, '0'))`, for
    ordering.
- [X] T008 Create `src/server/feedback/list.ts`:
  - `listFeedback()` loads every item ordered by `SQL_EFFECTIVE_KEY DESC, id DESC`, plus its tags,
    attachments and full state history, oldest first. Use four queries grouped in memory; no N+1.
  - `getFeedbackItem(id)` returns one item, or throws `NotFoundError` via `assertId`.
  - A mapper `toFeedbackItem(...)` builds the `FeedbackItem` shape:
    - `state` is the last history entry;
    - `manuallyPlaced` is `rank !== null`;
    - attachment `url` is `/api/feedback/attachments/{id}` and `thumbUrl` is the same with
      `?thumb=1`;
    - `path` is `repoRelative(attachmentAbsPath(file_path))`.
- [X] T009 Create `src/server/feedback/exportFile.ts`:
  - `renderFeedbackFile(items, nodeLabels, now)` is a pure function producing exactly the format in
    contracts/feedback-file.md:
    - the header with the `npm run feedback:addressed -- <item id>` command;
    - an Open section in list order;
    - Addressed and Resolved sections ordered by latest event, newest first;
    - `_None._` for empty sections;
    - each text line prefixed `> `, the full history oldest first, and repo-relative attachment
      paths.
  - `regenerateFeedbackFile(db = defaultDb)`:
    1. inside a transaction, take `pg_advisory_xact_lock(hashtext('farabi_feedback_file'))`;
    2. call `listFeedback()`;
    3. load node labels (the latest `node_summaries.text` per referenced node, else the placeholder
       from `src/server/summaries/placeholder.ts`);
    4. write `FEEDBACK.md.tmp`, then `fs.rename` it over `FEEDBACK.md`.

    Return the path. Accept a `db` argument so the scripts can pass their own connection.
- [X] T010 [P] Extend `tests/integration/helpers.ts`:
  - add routes for `/api/feedback`, `/api/feedback/{id}/position`, `/api/feedback/{id}/resolve`,
    `/api/feedback/{id}/reopen` and `/api/feedback/attachments/{id}`;
  - add `callForm(path, formData)`, which posts a `FormData` body without a JSON content type;
  - add `createFeedback({ text, view, nodeId?, tags?, images? })`, built on `callForm`;
  - add `readFeedbackFile()`, which returns the current `FEEDBACK.md` text.

  Also add PNG fixture bytes (a 1×1 PNG as a base64 constant) in `tests/integration/fixtures.ts`.
- [X] T011 [P] Unit tests in `tests/unit/f3-rank-key.test.ts`:
  - `keyBetween` always returns `lo < k < hi` byte-wise, including 200 repeated insertions into the
    same gap;
  - null ends work;
  - equal keys follow the tie rule;
  - `createdAtKey` sorts the same as the dates.
- [X] T012 [P] Unit tests in `tests/unit/f3-feedback-file.test.ts`: `renderFeedbackFile` with
  fixed inputs produces the expected sections and order, blockquotes a multi-line text containing
  `# heading`, lists attachment paths and the full history, and prints `_None._` for empty sections.

**Checkpoint**: `npm run typecheck && npm test` pass, with Features 1 and 2 unchanged.

---

## Phase 3: User Story 1 — Capture feedback from anywhere (Priority: P1) 🎯 MVP

**Goal**: A top-bar button opens a drawer from any view. Text plus optional tags are saved at once,
with the current view and node recorded and no AI involved.

**Independent Test**: Submit from a conversation and from the map. Both items exist with the right
`view` and `nodeId`, whitespace-only text is refused, and submitting works with the AI unreachable.

### Tests for User Story 1

- [X] T013 [P] [US1] Integration tests in `tests/integration/f3-us1-capture.test.ts`:
  - `POST /api/feedback` with text only returns 201 with `state: "open"` and one
    `user_authored` history entry;
  - `view: "chat"` with a real `nodeId` stores it;
  - `view: "map"` stores `nodeId: null`;
  - `view: "map"` with a `nodeId` returns 422;
  - whitespace-only text returns 422 and stores no row;
  - tags `["Map View", "map  view", "chat"]` are stored as two tags with keys `map view` and `chat`;
  - an unknown `nodeId` returns 422;
  - with `AI_PROVIDER=claude` and no key, create still returns 201. Also assert that no module
    under `src/server/feedback` imports from `src/server/ai`.
- [X] T014 [P] [US1] Unit tests in `tests/unit/f3-context.test.ts` for `feedbackContext(pathname)`:
  `/n/<uuid>` gives chat with that id; `/` gives chat and null; `/map` gives map and null;
  `/definitions` gives definitions and null; an unknown path gives chat and null.
- [X] T015 [P] [US1] Playwright test in `tests/e2e/f3-us1-capture.spec.ts`, for quickstart
  scenario 1:
  - the Feedback button is visible on `/`, `/n/{id}`, `/map` and `/definitions`;
  - opening the drawer leaves the URL unchanged;
  - submitting from a conversation, then from the map, shows both items with context labels;
  - the submit button is disabled for whitespace-only text;
  - text-only submission completes in under 1 s (SC-002).

### Implementation for User Story 1

- [X] T016 [US1] Create `src/server/feedback/create.ts` with `createFeedback(fields, files = [])`.
  For US1, the text and tags path only; US5 adds files.
  1. Validate with `FeedbackCreateFields`.
  2. If `nodeId` is given, check the node exists, or raise `InvalidRequestError`.
  3. De-duplicate tags by `termKey()` from `src/shared/termKey.ts`, keeping the first spelling.
  4. In one transaction, insert the item (`provenance 'user_authored'`), its tags, and its first
     state event (`state 'open'`, `provenance 'user_authored'`).
  5. After the commit, call `regenerateFeedbackFile()`.
  6. Return `getFeedbackItem(id)`.
- [X] T017 [US1] Route `src/app/api/feedback/route.ts` (`export const dynamic = "force-dynamic"`):
  - `GET` returns `{ items: await listFeedback() }`;
  - `POST` reads `await req.formData()`, parses the `text`, `view`, `nodeId` and `tags` (JSON
    string) fields, collects the `image` and `thumb` file entries (used in US5), calls
    `createFeedback`, and responds 201 `{ item }`.
- [X] T018 [P] [US1] Create `src/lib/feedbackContext.ts`, with
  `feedbackContext(pathname): { view, nodeId }` per research R2. Add `listFeedback()` and
  `createFeedback(fields, images)` to `src/lib/api.ts`. `createFeedback` builds the `FormData`.
- [X] T019 [P] [US1] Create `src/state/feedbackStore.ts` (Zustand) with:
  - `open` and `setOpen`;
  - `draft { text, tags: string[], images: DraftImage[] }` with setters, kept while the drawer is
    closed;
  - `items` and `load()`, which calls `api.listFeedback()`;
  - `submit(context)`, which creates the item, prepends it to `items` and clears the draft;
  - `filterKey: string | null`.
- [X] T020 [US1] Create `src/components/feedback/FeedbackButton.tsx`, a top-bar button labelled
  "Feedback" with the count of `open` items, that toggles the drawer. Create
  `src/components/feedback/FeedbackDrawer.tsx`:
  - a fixed right-side panel with `role="complementary"` and `aria-label="Feedback"`;
  - `Esc` closes it;
  - it loads items the first time it opens;
  - it renders `FeedbackForm` above `FeedbackList`.

  Mount both in `src/app/layout.tsx`: the button inside `.topbar` after `NewConversationButton`,
  and the drawer inside `<main>` after `MapHost`. Neither may change the route.
- [X] T021 [US1] Create `src/components/feedback/FeedbackForm.tsx`:
  - a textarea (autofocus when the drawer opens);
  - a tag input that adds a chip on Enter or comma, with × to remove a chip before submitting;
  - a Submit button, disabled while `text.trim()` is empty or a submit is in flight;
  - `Cmd/Ctrl+Enter` submits;
  - on submit, read the context with `feedbackContext(usePathname())` and call `store.submit`;
  - on error, show the server message inline and keep the draft.
- [X] T022 [US1] Create a minimal `src/components/feedback/FeedbackList.tsx` and
  `src/components/feedback/FeedbackCard.tsx` that render items in the order the server returns them.
  Each card shows text (with preserved line breaks), tag chips, a state badge, the capture time,
  and a context label: "Chat · <node label link to /n/{id}>", "Chat", "Map" or "Definitions". Add
  the drawer and card styles to `src/app/globals.css`, using the existing design tokens.

**Checkpoint**: US1 works on its own, and `FEEDBACK.md` already lists the new items.

---

## Phase 4: User Story 2 — Browse and organize the feedback panel (Priority: P1)

**Goal**: Items are listed newest first. Dragging an item persists its position without moving
untouched items, and the list can be filtered by one tag.

**Independent Test**: Drag the oldest item to the top and reload; only its `rank` changed. Filter
by `map view` and clear it; the order is the same.

### Tests for User Story 2

- [X] T023 [P] [US2] Integration tests in `tests/integration/f3-us2-organize.test.ts`:
  - four items created in sequence are listed newest first, all with `manuallyPlaced: false`;
  - `PUT /position { aboveId: null, belowId: <newest> }` on the oldest item moves it to the top,
    and a snapshot of `rank` for every other row is unchanged (SC-006);
  - dropping between two items puts it between them;
  - a new item then appears above the dragged one;
  - 50 repeated drops into the same gap keep a strict order;
  - `aboveId` below `belowId` returns 422, and the item as its own neighbour returns 422;
  - an unknown neighbour returns 404;
  - `FEEDBACK.md`'s Open section follows the new order.
- [X] T024 [P] [US2] Playwright test in `tests/e2e/f3-us2-organize.spec.ts`, for quickstart
  scenario 2:
  - drag the oldest card to the top with the handle, reload, and it is still first;
  - the other cards keep their relative order;
  - filtering by the `Map  View` chip shows only that item, and clearing the filter restores the
    same order;
  - `Alt+↑` on a focused card moves it up one place.

### Implementation for User Story 2

- [X] T025 [US2] Create `src/server/feedback/position.ts` with
  `moveFeedback(id, aboveId, belowId)`:
  1. load the item and both neighbours, raising `NotFoundError` if any is missing;
  2. raise `InvalidRequestError` if a neighbour is the item itself, or if `effectiveKey(above)`
     is not greater than `effectiveKey(below)`, allowing equality for the tie rule;
  3. set `rank = keyBetween(belowKey, aboveKey)`, updating only the `rank` column of this row;
  4. regenerate the file;
  5. return the item.

  Route: `src/app/api/feedback/[id]/position/route.ts` (PUT, `FeedbackPositionRequest`).
- [X] T026 [P] [US2] Add `moveFeedback(id, aboveId, belowId)` to `src/lib/api.ts`. In
  `src/state/feedbackStore.ts`, add `move(id, toIndex)`, which works out the visible neighbours
  under the current filter, reorders `items` optimistically, calls the API, and reloads on failure.
- [X] T027 [US2] Add drag-to-reorder to `src/components/feedback/FeedbackList.tsx` and
  `FeedbackCard.tsx` (research R10):
  - a drag handle on each card, with pointer events and `setPointerCapture`;
  - a drop-line indicator between cards, and auto-scroll near the drawer's top and bottom edges;
  - `store.move` on drop;
  - `Alt+ArrowUp` and `Alt+ArrowDown` on a focused card move it one place;
  - a small "moved" marker on cards with `manuallyPlaced`.
- [X] T028 [P] [US2] Create `src/components/feedback/TagFilter.tsx`:
  - chips for every distinct tag key across `items`, showing the first-seen spelling and a count;
  - clicking a chip sets `filterKey`, and clicking it again or "All" clears it.

  `FeedbackList` hides items whose tags do not include `filterKey` (keys from `termKey`) without
  changing order. Also export `termKey` for client use. It already lives in `src/shared/`.

**Checkpoint**: US1 and US2 both work independently.

---

## Phase 5: User Story 3 — Claude Code reads and acts on feedback (Priority: P1)

**Goal**: `FEEDBACK.md` always reflects the database, and
`npm run feedback:addressed -- <id>` moves only `open` items to `addressed`.

**Independent Test**: Run the script against an open item (exit 0, file updated in under 1 s),
then again (exit 2, no change), then against an unknown id (exit 3).

### Tests for User Story 3

- [X] T029 [P] [US3] Integration tests in `tests/integration/f3-us3-claude-code.test.ts`:
  - after create, the file exists at `FEEDBACK_DIR/FEEDBACK.md` and contains the item id, text,
    tags, view and node id;
  - the file's modification time is within 1 s of the create (SC-004);
  - `markAddressed(openId)` returns `"addressed"`, adds exactly one `addressed` / `ai_suggested`
    event, and moves the item to the file's Addressed section;
  - a second `markAddressed` returns `"not_open"` with the same event count;
  - `markAddressed` on a resolved item returns `"not_open"`;
  - an unknown uuid returns `"not_found"`;
  - text, tags and attachments rows are byte-identical before and after (SC-007).
  - One test spawns `npx tsx scripts/feedback-addressed.ts <id>` with
    `DATABASE_URL=TEST_DATABASE_URL` and `FEEDBACK_DIR` set, and asserts exit codes 0, 2, 3 and 1
    (for a malformed id).
  - Two concurrent `regenerateFeedbackFile()` calls leave a complete file (the advisory lock).
  - Making the folder unwritable leaves the previous file in place, and the create still returns
    201.

### Implementation for User Story 3

- [X] T030 [US3] Create `src/server/feedback/state.ts`:
  - an internal `latestState(trx, id)` that runs `SELECT ... FROM feedback_items WHERE id = $1
    FOR UPDATE`, then reads the latest `feedback_state_events` row;
  - `markAddressed(id, db = defaultDb): Promise<"addressed" | "not_open" | "not_found">`, which
    inserts `{ state: 'addressed', provenance: 'ai_suggested' }` only when the latest state is
    `open`, then regenerates the file with the same `db`.

  This module exports no other way to write `addressed`.
- [X] T031 [US3] Create `scripts/feedback-addressed.ts`:
  - `loadEnv()`, then require exactly one argument that matches the UUID regex; otherwise print
    usage to stderr and exit 1;
  - `createDb(process.env.DATABASE_URL)`, then `markAddressed(id, db)`;
  - print the stdout messages from contracts/feedback-file.md and exit 0, 2 or 3, or 1 on an
    exception;
  - always `db.destroy()`.

  Create `scripts/feedback-export.ts`, which regenerates the file and prints its path. Neither
  script accepts any other option.
- [X] T032 [US3] Create `src/instrumentation.ts`, whose `export async function register()`, when
  `process.env.NEXT_RUNTIME === "nodejs"`, dynamically imports `@/server/feedback/exportFile` and
  calls `regenerateFeedbackFile()`, catching and logging errors so a database that is down never
  blocks start-up. Check the file convention in
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md`
  first.
- [X] T033 [US3] Add a short "Feedback" section to `CLAUDE.md`, below the `@AGENTS.md` line and
  never inside the `AGENTS.md` block Next.js manages. It says:
  - outstanding feedback is in `feedback/FEEDBACK.md`, and screenshots are at the listed paths;
  - after finishing an item's work, run `npm run feedback:addressed -- <id>`;
  - never edit `FEEDBACK.md` or feedback tables directly, and never mark anything resolved.

**Checkpoint**: The loop closes from the terminal. US1–US3 (the P1 set) are complete.

---

## Phase 6: User Story 4 — Confirm or reopen an item (Priority: P2)

**Goal**: The user resolves items, directly or after `addressed`, and reopens them, and every
transition is kept.

**Independent Test**: Take an item through open → addressed (script) → resolved → open. The history
shows four timestamped entries.

### Tests for User Story 4

- [X] T034 [P] [US4] Integration tests in `tests/integration/f3-us4-resolve.test.ts`:
  - resolve from `addressed` gives `resolved` / `user_confirmed`;
  - resolve from `open` is allowed (FR-014);
  - resolve when already `resolved` returns 409 `invalid_transition`;
  - reopen from `resolved` and from `addressed` gives `open` / `user_authored`;
  - reopen when `open` returns 409;
  - after open → addressed → resolved → open, `history` has four entries in order with strictly
    increasing times (SC-005);
  - the file's History lines match;
  - the app has no route that sets `addressed`: grep `src/app/api/feedback` for `"addressed"`
    writes.
- [X] T035 [P] [US4] Playwright test in `tests/e2e/f3-us4-resolve.spec.ts`, for quickstart
  scenario 4. Set `addressed` by calling the exported `markAddressed` through a test-only helper,
  or by running the script with `TEST_DATABASE_URL`. Then:
  - the card shows "Claude Code says done — confirm?";
  - Confirm shows resolved;
  - Reopen shows open;
  - the history disclosure lists all four transitions.

### Implementation for User Story 4

- [X] T036 [US4] Add `resolveFeedback(id)` and `reopenFeedback(id)` to
  `src/server/feedback/state.ts`, both using `latestState` with the row lock:
  - resolve is allowed from `open` or `addressed` and inserts `resolved` / `user_confirmed`;
  - reopen is allowed from `addressed` or `resolved` and inserts `open` / `user_authored`;
  - any other case raises `ConflictError("invalid_transition", ...)`.

  Both regenerate the file and return the item. Add the routes
  `src/app/api/feedback/[id]/resolve/route.ts` and `src/app/api/feedback/[id]/reopen/route.ts`
  (POST, `{ item }`).
- [X] T037 [US4] Client: add `resolveFeedback` and `reopenFeedback` to `src/lib/api.ts`, and the
  matching store actions that replace the item in `items`. In `FeedbackCard.tsx`:
  - the state badge is styled distinctly for the three states, with `addressed` rendered as an
    AI-suggested badge ("Claude Code says done — confirm?"), never looking like resolved
    (Article I);
  - buttons: Confirm (for `addressed`), Resolve (for `open`), Reopen (for `addressed` or
    `resolved`);
  - a "History" disclosure lists every event with time and who made it: "you" or "Claude Code".

  Make the top-bar count in `FeedbackButton` show `open` items and, separately, the number
  awaiting confirmation.

**Checkpoint**: The user has the final word on every item.

---

## Phase 7: User Story 5 — Attach a screenshot for visual context (Priority: P2)

**Goal**: Images pasted or dropped into the form are previewed, stored once under the item's
folder, shown as thumbnails with a full-size view, and listed in `FEEDBACK.md`.

**Independent Test**: Paste an image and submit. The thumbnail shows, the full image opens, the file
exists at the path in `FEEDBACK.md`, and its SHA-256 matches after the item is resolved.

### Tests for User Story 5

- [X] T038 [P] [US5] Integration tests in `tests/integration/f3-us5-attachments.test.ts`:
  - create with two PNG images and one thumbnail stores two rows, and the files land at
    `FEEDBACK_DIR/attachments/<itemId>/<attachmentId>.png`, with a `.thumb.webp` file for the
    first;
  - SHA-256 on disk matches the database;
  - the attachment route streams the image with the right content type;
  - `?thumb=1` falls back to the original when there is no thumbnail;
  - `FEEDBACK.md` lists both paths;
  - an 11th image returns 422, a file over 10 MB returns 422, and a `.png`-named text file returns
    422 (magic bytes); in each case no item row exists and no files are left behind;
  - after resolve, the files and hashes are unchanged (FR-023);
  - an unknown attachment id returns 404.
- [X] T039 [P] [US5] Playwright test in `tests/e2e/f3-us5-screenshots.spec.ts`, for quickstart
  scenario 5:
  - dispatch a paste event with a PNG `File`, and a drop with another;
  - two previews appear;
  - after submitting, two thumbnails appear, and clicking one opens the lightbox with the full
    image loaded;
  - an 11th image is refused in the form with a message.

### Implementation for User Story 5

- [X] T040 [US5] Create `src/server/feedback/attachments.ts`:
  - `sniffImageType(bytes)` recognises PNG `89 50 4E 47`, JPEG `FF D8 FF`, GIF `GIF8`, and WebP
    `RIFF....WEBP`, else returns null;
  - `validateUploads(images, thumbs)`: at most 10 images, each `byte_size BETWEEN 1 AND 10485760`,
    each sniffed type allowed; thumbnails must sniff as WebP and be at most 1 MB, and an invalid
    thumbnail is dropped, not an error;
  - `writeAttachmentFiles(itemId, uploads)` creates `attachments/<itemId>/` and writes each file
    with `fs.writeFile(path, bytes, { flag: "wx" })`, returning rows with `file_path`,
    `thumb_path`, `sha256` (`crypto.createHash("sha256")`), `mime_type`, `byte_size` and
    `original_name`;
  - `removeWrittenFiles(paths)` is used only to clean up after a failed, uncommitted create;
  - `openAttachment(id, thumb)` returns `{ stream, mimeType }` or throws `NotFoundError`.
- [X] T041 [US5] Extend `createFeedback` in `src/server/feedback/create.ts`:
  1. validate uploads before the transaction;
  2. pick the item id up front (`crypto.randomUUID()`);
  3. write the files, then insert the attachment rows in the same transaction as the item;
  4. if anything fails, call `removeWrittenFiles` and rethrow.

  Wire the `image` and `thumb` entries in `src/app/api/feedback/route.ts`. Create
  `src/app/api/feedback/attachments/[id]/route.ts` (GET) to stream the file with `Content-Type`
  and `Cache-Control: private, max-age=31536000, immutable`, honouring `?thumb=1`.
- [X] T042 [P] [US5] Create `src/lib/thumbnail.ts`: `makeThumbnail(file): Promise<Blob | null>`
  uses `createImageBitmap` and a canvas scaled to 320 px on the long side, then
  `canvas.toBlob(..., "image/webp", 0.8)`, returning null on any failure.
- [X] T043 [US5] In `FeedbackForm.tsx`:
  - handle `onPaste` (`clipboardData.files` filtered to images) and `onDragOver`/`onDrop` on the
    form;
  - add the images to `draft.images` with an object-URL preview and thumbnail;
  - enforce 10 images and 10 MB in the client with an inline message;
  - allow removing a draft image before submitting.

  In `src/lib/api.ts` `createFeedback`, append each `image` and its `thumb` to the form.
- [X] T044 [US5] In `FeedbackCard.tsx`, render attachment thumbnails from `thumbUrl` with
  `loading="lazy"` and `decoding="async"`. Create `src/components/feedback/Lightbox.tsx`, which
  shows `url` full size inside the drawer and closes on `Esc` or a click on the backdrop. Revoke
  draft object URLs after submitting.

**Checkpoint**: All five stories work independently.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T045 [P] Add `tests/integration/f3-append-only.test.ts` (Articles I, II and VI):
  - raw `UPDATE` and `DELETE` on `feedback_state_events`, `feedback_tags` and
    `feedback_attachments` throw;
  - `DELETE` on `feedback_items` throws, and `UPDATE feedback_items SET text = ...` throws;
  - `UPDATE ... SET rank = ...` succeeds;
  - inserting `{ state: 'resolved', provenance: 'ai_suggested' }` or
    `{ state: 'addressed', provenance: 'user_confirmed' }` violates the check constraint.

  Extend the existing guard test in `tests/integration/constitution.test.ts` so it keeps covering
  `src/app/api/feedback/**`; it already scans every `route.ts`.
- [X] T046 [P] Extend `scripts/seed-large.ts` with a `--feedback N` option that seeds N items,
  about one in three with a generated PNG attachment written through `writeAttachmentFiles`, plus
  mixed tags and states, then regenerates the file. Add a Playwright check to
  `tests/e2e/scale.spec.ts`: with 200 seeded items, the drawer opens in under 1 s and scrolling to
  the bottom keeps frames under 50 ms, measured in-page as in Feature 2's SC-006 check (SC-008).
  Add `content-visibility: auto` to feedback cards in `src/app/globals.css`.
- [X] T047 [P] Add a "Feedback" section to `README.md`: the drawer, where files live, that
  `feedback/` is git-ignored, and the `feedback:addressed` and `feedback:export` commands.
- [X] T048 Run `npm run typecheck && npm run lint && npm test && npm run test:e2e`, then walk
  through quickstart.md by hand against `npm run dev`, including one run of
  `npm run feedback:addressed` from a real terminal. Record findings under "Implementation notes"
  in this file.

---

## Dependencies & Execution Order

- **Setup (T001–T004) → Foundational (T005–T012)** block everything.
- **US1** first: it creates items, and every other story needs items.
- **US2, US3 and US5** each need only US1. They can run in parallel, but all three touch
  `FeedbackCard.tsx` or `create.ts`, so either merge carefully or go in the order US2 → US3 → US5.
- **US4** needs US3's `state.ts` (it shares `latestState`) and its tests use `markAddressed`.
- **Polish** comes last.

```text
Setup → Foundational → US1 ─┬→ US2
                            ├→ US3 → US4
                            └→ US5
```

Within each story, write the tests first and confirm they fail, then build the server, then the
routes, then the client.

## Implementation notes (2026-09-27)

- Tags, attachments and state events default `created_at` to `clock_timestamp()` and are inserted
  one row at a time, so an item's tags and screenshots keep the order they were given in. Rows
  inserted in one statement shared a timestamp and came back in random order. The migration was
  re-applied on the dev and test databases, whose feedback tables were still empty.
- The SQL sort key uses `floor(...)`. A plain `::bigint` cast rounds the microseconds Postgres
  stores, while JavaScript `Date` drops them, so the two keys could differ by 1 ms and a drag to the
  top could land second.
- `REPO_ROOT` is `process.cwd()`, because `import.meta.dirname` is not reliable in Next.js server
  bundles. `path.resolve` carries a `turbopackIgnore` comment so the build does not trace the whole
  project. The one remaining build warning comes from Feature 1's Claude Code provider (`spawn`).
- Integration setup empties the throwaway `FEEDBACK_DIR` before each test, as it truncates the
  database.
- The cleanup-after-failed-create test forces the failure with a temporary database trigger that
  refuses the attachment insert. A failed create now also removes the item's empty folder.
- Scale check (SC-008), production build, 200 items with 67 screenshots of 1280×800: the drawer
  opens in about 600 ms, and scrolling stays at 17 ms per frame (median and 95th percentile).
- `.gitignore` uses `/feedback/` and `/.feedback-test/`, anchored to the repo root. A bare
  `feedback/` also ignored `src/server/feedback/`, `src/components/feedback/` and
  `src/app/api/feedback/`. This was caught from `git status` before anything was committed.
- Not done: a manual walkthrough against `npm run dev`. Feedback rows can never be deleted, so a
  smoke test would leave permanent items in the real database. The same flows run in Playwright
  against the test database, including the real `feedback:addressed` script.

## Parallel Opportunities

- Setup: T003, T004
- Foundational: T006, T007, T010, T011, T012
- US1: T013, T014, T015, T018, T019
- US2: T023, T024, T026, T028
- US3: T029
- US4: T034, T035
- US5: T038, T039, T042
- Polish: T045, T046, T047

## Parallel Example: User Story 1

```bash
Task: "Integration tests for capture in tests/integration/f3-us1-capture.test.ts"
Task: "Unit tests for feedbackContext in tests/unit/f3-context.test.ts"
Task: "Playwright test in tests/e2e/f3-us1-capture.spec.ts"
Task: "feedbackContext + api client in src/lib/feedbackContext.ts, src/lib/api.ts"
Task: "Zustand store in src/state/feedbackStore.ts"
```

## Implementation Strategy

1. Setup and Foundational: the schema, triggers, sort keys and file renderer.
2. **MVP**: US1 capture. Feedback can be logged from anywhere, and `FEEDBACK.md` already exists.
3. US3 next, so the loop with Claude Code closes as early as possible. Then US2 organization.
4. US4 confirm and reopen, and US5 screenshots.
5. Polish: the append-only guard tests, the scale check, docs, and a full run.
