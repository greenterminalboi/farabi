# Contract: Feedback file and the "addressed" script

This contract covers the interface Claude Code uses (FR-017 – FR-020). Claude Code only ever reads
`FEEDBACK.md` and runs the one script. It never edits the file and never touches the database
directly.

## Location

`<FEEDBACK_DIR>/FEEDBACK.md`. `FEEDBACK_DIR` defaults to `feedback/` at the repo root and can be
overridden in the environment (tests do this). `CLAUDE.md` documents the path.

## Regeneration

- The file is regenerated in full after every committed feedback write:
  - creating an item (with its tags and attachments);
  - a reorder;
  - resolving or reopening an item;
  - the script marking an item addressed.
- It is also regenerated when the server starts, and by `npm run feedback:export`.
- It is written to `FEEDBACK.md.tmp` and then renamed over the old file, under a Postgres advisory
  lock (research R6). A failed write leaves the previous file untouched.

## Format

Markdown. Given the same data, the output is byte-for-byte the same, apart from the `Generated`
line. Example:

```markdown
# Farabi feedback

<!-- Generated from the database. Do not edit; changes here are overwritten. -->

Generated 2026-09-27T14:05:12.345Z · 3 open · 1 addressed · 4 resolved

To mark an item addressed after you have done the work:

    npm run feedback:addressed -- <item id>

Only the user can mark an item resolved. Attachment paths are relative to the repo root.

## Open

Listed in the user's panel order (the most important are usually first).

### 5b1c0e2a-8f41-4c7e-9d4b-2f0a6c1e9b77

- State: open (since 2026-09-27T13:58:40.101Z)
- Captured: 2026-09-27T13:58:40.101Z · view: chat · node: 0c9f…e41a ("Kubernetes scheduling")
- Tags: map, layout
- Attachments:
  - feedback/attachments/5b1c0e2a-8f41-4c7e-9d4b-2f0a6c1e9b77/a7e2…90c1.png
- History:
  - 2026-09-27T13:58:40.101Z open (user_authored)

> Edge labels overlap the node when the child is directly under the parent.
> Happens after dragging.

## Addressed

Claude Code marked these done. They wait for the user to confirm or reopen them.

### …

## Resolved

### …
```

Rules:

- Each item's heading is its **full id**, the exact argument the script takes.
- Within **Open**, items follow the panel order. **Addressed** and **Resolved** are ordered by the
  time of their latest state event, newest first.
- The node label is the node's current map label (its latest summary, or the placeholder). It is
  shown only as a hint; the node id is authoritative. The label is left out when there is no node.
- Every line of the text is written as a `> ` blockquote, so Markdown in the text cannot create
  headings in the file.
- The history lists every state event, oldest first (FR-016).
- An empty section shows `_None._`.

## Script: `npm run feedback:addressed -- <item id>`

Implemented in `scripts/feedback-addressed.ts`, which calls `markAddressed()` in
`src/server/feedback/state.ts`.

| Situation | Effect | stdout | Exit |
|-----------|--------|--------|------|
| Item is `open` | adds one `addressed` / `ai_suggested` event, then regenerates the file | `Marked <id> addressed.` | 0 |
| Item is `addressed` or `resolved` | nothing | `<id> is <state>; only open items can be marked addressed. No change.` | 2 |
| No item with that id | nothing | `No feedback item <id>.` | 3 |
| Missing or malformed id, database unreachable, other error | nothing | error on stderr | 1 |

- The script takes exactly one positional argument and **no options**. It cannot set another state
  or change text, tags, attachments or order (FR-020). The database triggers in data-model.md make
  those edits impossible for any client anyway.
- It needs the Docker Postgres to be running, but not the Next.js app.

## Script: `npm run feedback:export`

Regenerates `FEEDBACK.md` from the database, then prints its path. It changes no data.
