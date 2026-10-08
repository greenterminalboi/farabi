# UI Contract: Drill Screen and Canvas Card

## Canvas (C3, in the v0.2 lane's files)

- Display `drill`: a card with the domain, "Rung *n*: ‹name› · level *L*" or "Complete", and
  "from ‹parent›" when the drill has a parent drill. Clicking it focuses the card, as for any node.
  Opening it (double-click, Enter, or the card's Open button) navigates to `/drill/:drillId`.
- Elements of kinds with `onCanvas: false` are never mounted. An element with `drawnFrom` set is laid
  out and connected as a child of that element.
- The canvas "new" menu gains **New drill** (project scope), which opens the create form as an overlay
  and does not leave the canvas until the drill exists.

## Drill screen (`/drill/:drillId`)

| Region | Contents |
|--------|----------|
| Header | Domain, Back to canvas (focuses the drill node), settings (round size and thresholds), attachments |
| Ladder (left) | Rungs in order, with their state and level, a sparkline of level by round, and an edit mode. Before start: edit, reorder, remove, add, then Start. |
| Main | The current lesson when a rung has just opened (dismissible, reachable from its rung). Then the **current problem**: its text, an answer box, Submit, Hint, Show solution, Flag, Skip. After a verdict: the verdict, its feedback, Override, Try again, Next, and the follow-up box. |
| Round strip | One chip per problem with its result. Clicking one reopens it (FR-009). It includes End round, and the round note once the round has ended. |
| Failed problems | Open `not_solved` and `partly_solved` problems from earlier rounds, each with Redo. |
| Completion | Once complete: "Ladder complete" and up to 3 offer cards (Drill this / Dismiss). Review rounds continue. |

- All element text is rendered with v0.2's `RichText` and has `data-node-id`, so
  `SelectionToolbar` offers Branch, Define and Park (FR-026).
- After a Branch or follow-up the user stays on the drill screen, and a link to the new edge appears
  under the problem.
- Every AI-made item shows the AI tag. Overridden verdicts show both verdicts, with the user's marked
  as the one that counts.

## Test hooks

- `data-testid`: `drill-card`, `drill-rung-<i>`, `drill-current-problem`, `drill-answer`,
  `drill-submit`, `drill-verdict`, `drill-override`, `drill-end-round`, `drill-round-note`,
  `drill-followup`, `drill-offer-<i>`.
- `window.__drill` (test builds only): `{ drillId, currentProblemId }`.

## As built (2026-10-07)

- The canvas card is the `drill` display (`.element-text.drill`), whose text is the element's
  `card` (C3); its Open button is `card-open`. There is no separate `drill-card` test id.
- v0.2's `SelectionToolbar` needs the canvas engine, so the drill screen has its own
  `DrillSelectionToolbar` on the same `selectionToAnchor`. A Branch is created and sent at once with
  the typed question, or the highlighted text, and a link to it appears under its problem.
- **New drill** is in the canvas menu (`new-drill`) and opens the create form as an overlay.
- From the drill screen, the canvas opens with `?focus=…&returnTo=/drill/…`, which shows **Back to
  drill** (`back-to-drill`). **Attach from canvas** opens it with `?attachTo=<drillId>`: a banner
  (`drill-attach-banner`) attaches the focused message or answer, then returns.
- After an attempt, the answered problem stays on screen with its verdict until **Next**. A newly
  opened rung's lesson appears once the user moves on to the new round.
