# Quickstart: Verifying the Chat Visual Refresh

## Prerequisites

- Work in the worktree: `/Users/halda/Projects/farabi-007-chat-visual-refresh` (branch
  `007-chat-visual-refresh`). Run `npm install` there once.
- Postgres running as for the other features. `npm run db:migrate` (no new migrations).

## Automated

```sh
npm run typecheck && npm run lint
npx playwright test tests/e2e/f7-chat-visual.spec.ts                          # this feature
npx playwright test tests/e2e/feedback-round-1.spec.ts tests/e2e/f2-us1-streaming.spec.ts \
  tests/e2e/f2-us4-definitions.spec.ts tests/e2e/f5-suggestions.spec.ts        # nearest regressions
npm run test:e2e                                                               # full suite (SC-004)
```

`f7-chat-visual.spec.ts` checks the [UI contract](./contracts/ui.md) at 1440, 1024 and 700px
wide:

- L2/L4: user bubble on the right edge, AI text on the left edge, both inside the list.
- L2: a one-word bubble is narrow, and a long message is capped and wraps.
- C1/C2: Send is icon-only with name "Send", sits inside the composer box, and is disabled when
  the draft is empty.
- C3: Stop appears in place of Send while streaming.
- C4: auto-grow still works (as in `feedback-round-1`).

## Manual (SC-001 – SC-003)

1. Start the app with `npm run dev`. Open a conversation and send "Hi", then a 4-line message.
   - Both user messages sit on the right in shaded, rounded bubbles sized to their text.
   - AI replies sit on the left, unshaded, with the purple **AI** tag.
2. Resize the window to wide, medium and narrow (under 820px). The conversation stays in one
   centered column, and bubbles and AI text share its edges. Nothing reaches the window edges on
   wide screens.
3. Look at the composer:
   - It is one rounded box with muted "Write a message…" text.
   - A round arrow icon sits inside the box's bottom-right corner, with no "Send" text.
   - Typing hides the placeholder. Shift+Enter a few times: the box grows to about half the
     screen, then scrolls.
   - Clicking the icon sends. While the reply streams, the icon becomes a stop square.
4. Branch from a phrase. The inherited context and anchor quote look as before and fit inside
   the column.
5. Check that definition underlines and suggested underlines still appear inside AI replies and
   still respond to clicks and hover.
6. Repeat step 1 with the system in dark mode.
