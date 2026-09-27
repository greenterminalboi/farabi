# Quickstart & Validation: In-App Feedback Loop

Run the app as in Feature 1 (`README.md`): `docker compose up -d`, then `npm run db:migrate`, then
`npm run dev`. The new migration adds the tables and triggers in [data-model.md](./data-model.md).

- Feedback is stored in the database, under `feedback/`, which is git-ignored (plan: open points).
- None of these scenarios need an AI provider. Run them once with `AI_PROVIDER=claude` and no API
  key to show the feature works with the AI unreachable (FR-021).

## Validation scenarios

Each scenario maps to a user story and should exist as a Playwright test.

1. **Capture from anywhere (US1)**
   - Open a conversation, click **Feedback**, type "chat test" and submit. The drawer stays open
     over the conversation, the URL is unchanged, and the item appears at the top as **open** with
     view `chat` and that node's id.
   - Go to the map and submit "map test". It appears with view `map` and no node.
   - Submit with only spaces. The submit button stays disabled and nothing is stored.
   - With `AI_PROVIDER=claude` and no key, submitting still succeeds in under 1 s (SC-002).
2. **Organize (US2)**
   - Submit items tagged `map`, `Map  View` and `chat`. They are listed newest first.
   - Drag the oldest item to the top and reload. It is still at the top, and every other item keeps
     its relative order (SC-006; the integration test also checks that no other row's `rank`
     changed).
   - Filter by `map view`. Only the `Map  View` item shows. Clear the filter and the full list
     returns in the same order.
   - Submit a new item. It appears above the dragged one.
3. **Claude Code loop (US3)**
   - Submit an item with a pasted screenshot. `feedback/FEEDBACK.md` lists it under **Open** with
     its text, tags, context and `feedback/attachments/<item>/<att>.png`, and that path opens.
   - Run `npm run feedback:addressed -- <id>`. It exits `0`, and within 1 s the file lists the item
     under **Addressed** with an `ai_suggested` history line (SC-004).
   - Run it again. It exits `2` and nothing changes: the event count is the same and the file is
     unchanged apart from `Generated` (SC-007).
   - Run it with a random uuid. It exits `3`.
4. **Confirm and reopen (US4)**
   - The addressed item shows **"Claude Code says done — confirm?"**. Click **Confirm** and it
     shows **resolved**.
   - Click **Reopen** and it shows **open**. Its history lists open → addressed → resolved → open
     with four timestamps (SC-005).
   - Resolve a never-addressed item directly. This is allowed.
5. **Screenshots (US5)**
   - Paste one image and drop another. Both previews show before submitting.
   - After submitting, both thumbnails show, and clicking one opens it full size.
   - Resolve the item. Its files are unchanged, and their SHA-256 still matches the database (FR-023).
   - Try an 11th image, or a 12 MB one. The form refuses it, and so does the API (`422`).

## Scale check

- `npm run seed:large` gains a `--feedback 200` option that seeds 200 items, about a third with
  screenshots. Open the drawer and scroll to the end: no visible stutter (SC-008), and the drawer
  opens in under 1 s on the production build.

## Constitution spot checks

- The existing guard test still finds no DELETE or PATCH handlers.
- A new integration test shows that `UPDATE` and `DELETE` on `feedback_state_events`,
  `feedback_tags` and `feedback_attachments` raise, and that updating `feedback_items.text` raises
  while updating `rank` does not.
- Every `addressed` event is `ai_suggested`, every `resolved` event is `user_confirmed`, and the
  database check constraint enforces this.
- No file under `src/server/feedback/` or `src/components/feedback/` imports `src/server/ai`.

## Commands

```bash
npm run typecheck && npm run lint
npm test                    # unit + integration (Postgres test DB)
npm run test:e2e            # Playwright, production build; FEEDBACK_DIR=.feedback-test
npm run feedback:export     # regenerate feedback/FEEDBACK.md by hand
```
