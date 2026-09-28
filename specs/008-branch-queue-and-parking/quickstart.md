# Quickstart: validating the Branch Queue

## Prerequisites

- Docker Postgres is running (`docker compose up -d`).
- Run `npm run db:migrate` to apply `0007_parked_tangents`.
- Checks can run on the fake AI provider. Integration and e2e tests set it through their helpers
  (`setAiMode`).

## Automated checks

```sh
npm run typecheck && npm run lint
npm test -- tests/integration/f8-parked.test.ts tests/integration/constitution.test.ts
npm run test:e2e -- tests/e2e/f8-branch-queue.spec.ts tests/e2e/us2-branch.spec.ts tests/e2e/f5-suggestions.spec.ts
npm test && npm run test:e2e   # full regression before merge
```

## What each scenario proves

| # | Scenario | Expected | Covers |
|---|----------|----------|--------|
| 1 | Select text in an AI reply, click Park, leave the question blank, press Enter | No new node (node count unchanged). The Parked tab shows 1 item with the anchor text and "No question…". The composer draft is unchanged. | US1-1, US1-4, US1-5, FR-007 |
| 2 | Park again with the question "How does this scale?" | The item shows the question. The API returns `question` exactly as typed. | US1-2, US1-3, FR-011 |
| 3 | Click Park, then Esc | Nothing is parked. | US1-6 |
| 4 | Park with "   " as the question | Stored with `question: null`. | FR-011 |
| 5 | In Parked, click "Ask in new branch" on the item with a question | The URL changes to a new node. Its first user message is exactly "How does this scale?", and a reply streams. The parent's Parked tab no longer lists the item, and its Branches tab lists the new node. A branch marker covers the parked span in the parent. | US2-1, US2-3, FR-012, FR-014, SC-002 |
| 6 | Click "Open as branch" on the item without a question | A new node opens with no messages, and its composer contains the anchor text. | US2-2, FR-013, SC-003 |
| 7 | Fire an item with the AI mode set to `fail` | The branch and its first message exist. The reply fails and shows "AI service unavailable … Retry". A question-less item still opens with the composer preloaded. | US2-4, edge case |
| 8 | Send two fire requests for one item at once (integration test) | One returns 201 and the other 409 `parked_consumed`. Exactly one child node exists. | FR-014, double-click edge case |
| 9 | Edit a question, clear another, discard a third | Each change affects only its own item. The discarded item disappears. Discarding creates no node. | US4, FR-015, SC-004, SC-005 |
| 10 | Park the same span twice, then Branch it directly | Three independent records: two parked items and one branch. None is merged away. | Edge cases |
| 11 | From a node with 2 children and 1 grandchild, open the Branches tab | Exactly the 2 children are listed, newest first. Clicking one opens it. | US3-1, US3-2, FR-002 |
| 12 | Navigate to a child while the panel is open | Both tabs show the child's own data, or their empty states. | US3-3, FR-004, FR-005 |
| 13 | Branch with the question "Why?" typed in the field | The new branch's composer contains "Why?", unsent. With a blank field, it contains the anchor text. | FR-009, FR-010 |
| 14 | Park on the latest reply, then try Regenerate | Regenerate isn't offered, and the API returns 409 `has_parked`. After discarding the item, Regenerate is offered again. | Research R6, FR-017 |
| 15 | Type `????` after parking | The quick branch behaves exactly as before. | FR-016 |
| 16 | Collapse the panel and reload | It stays collapsed. | Research R7 |

## Manual look

Run `npm run dev` and open a conversation. Check the panel at wide and narrow window sizes: the
chat narrows beside it, and the panel overlays the chat only below 640px. Check that the two-step toolbar form doesn't jump when the input
is focused.
