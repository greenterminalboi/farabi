# Quickstart & Validation: Map Interactions, Definitions, and Streaming

Run the app as in Feature 1 (`README.md`): `docker compose up -d`, `npm run db:migrate`,
`npm run dev`. The new migration adds the columns and tables in [data-model.md](./data-model.md).
Automated tests use the fake provider; scenarios 1–2 are worth one manual run with
`AI_PROVIDER=claude-code` too.

## Validation scenarios

Each maps to a user story and should exist as a Playwright test (fake provider).

1. **Streaming (US1)** — Send a message: the reply's first chunk appears before the last (fake:
   5 chunks, 40 ms apart). Press Stop mid-reply → text kept, marked "stopped", Retry offered. Set
   the fake to `stall` → text kept, marked "incomplete", survives a reload. Start a reply, switch to
   the map and back → the finished reply is there (FR-004).
2. **Quick branch (US2)** — Send "What is a sidecar?", then `????` → a new branch opens with
   "What is a sidecar?" as its first message and a reply streaming; the parent shows a whole-message
   marker and no `????`; the fake provider never received `????`. Send `????` again in the parent →
   it's an ordinary message (FR-012). Send "does this mean ????" → ordinary message.
3. **Dragging (US3)** — Drag a root → its whole tree moves; drag a non-root node → only it moves,
   lines follow. Reload → both positions kept, `userPlaced` set, every line joins the same nodes.
   Add a branch to the dragged tree → the hand-placed node stays, others re-lay out. Click (no drag)
   a node → its conversation opens.
4. **Definitions (US4)** — Highlight "Containers" in a reply → Send to definitions → the tab shows
   a draft with both parts and a source link. Capture "containers" from another conversation → no
   duplicate, the existing entry is shown. Hover any "containers" in any conversation → the card
   appears. Confirm one draft; edit another → both show "confirmed"; history shows the draft too.
5. **Edge labels (US5)** — Click a line → type "requires understanding of" → reload → the label is
   drawn. Edit it, then clear it → gone from the map, both changes in history.

## Scale checks

- `npm run seed:large` extended with 500 definitions → Definitions tab opens < 1 s; a conversation
  with marked terms opens < 1 s; hover card < 300 ms (SC-009, SC-009a).
- Drag a node in the 500-node map → no visible lag (SC-006).

## Constitution spot checks

- No DELETE/PATCH handlers (existing guard test covers new routes).
- Every definition draft version is `ai_suggested`; confirm/edit versions `user_confirmed`; every
  edge label version `user_authored`.
- No endpoint writes `nodes.parent_id` after creation (drag never re-parents).
