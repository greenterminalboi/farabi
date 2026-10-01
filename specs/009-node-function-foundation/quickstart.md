# Quickstart: validating the Node Function Foundation

## Prerequisites

- Docker Postgres is running (`docker compose up -d`).
- The Feature 5 rework (`0008_drop_span_suggestions`) is merged. Then run `npm run db:migrate`
  to apply `0009_node_functions`.
- The checks run on the fake AI provider. Integration and e2e tests set it through their helpers
  (`setAiMode`). For a manual check with real analogies, set `AI_PROVIDER=claude` or
  `claude-code`.

## Automated checks

```sh
npm run typecheck && npm run lint
npm test -- tests/unit/f9-*.test.ts tests/integration/f9-functions.test.ts tests/integration/constitution.test.ts
npm run test:e2e -- tests/e2e/f9-node-functions.spec.ts
npm test && npm run test:e2e   # full regression (SC-001: every Feature 1–8 test still passes)
```

## Scenarios

Shapes are defined in [contracts/http-api.md](./contracts/http-api.md), and state rules in
[data-model.md](./data-model.md).

| # | Scenario | Expected | Covers |
|---|----------|----------|--------|
| 1 | Migrate a database that has Feature 1–8 data | Every node has `kind = 'conversation'` and an `origin` matching its history (root, branch, quick branch, parked). Node, message, marker, definition and feedback counts are unchanged. | FR-001, FR-038, SC-001 |
| 2 | Start a conversation and send one message. Before the summary exists, open Functions. | Analogy is listed, disabled, with "no summary yet…". | US1 AS3, FR-010 |
| 3 | After the summary appears, run Analogy from the chat header | "Analogy ready · Open". On the map, an "AI · Analogy" box sits to the right of the source, joined by a dashed pipe with an arrow. The source's messages, summary and position are unchanged. | US1 AS1, AS5, FR-011, FR-016, FR-039, SC-002 |
| 4 | Open Functions on the analogy node (map selection) | No functions are listed. | US1 AS2, FR-009 |
| 5 | Run Analogy with AI mode `fail` | 503. The menu shows the error and Retry. There is no new node or pipe, and version and pipe counts are unchanged. Retry in `ok` mode then succeeds. | US1 AS4, FR-012 |
| 6 | Double-click the analogy | `/n/{id}` shows the analogy beside the source conversation (read-only), with "Open conversation". There is no highlight toolbar. | US2 AS2, AS5, FR-005, FR-019 |
| 7 | Double-click the source conversation | Chat opens exactly as before. Its Branches tab doesn't list the analogy. | US2 AS3, FR-017 |
| 8 | Click the pipe | The pipe card shows "Analogy v1", "reads the summary", "Proposed", "1 version". The URL is unchanged. Clicking a parent-child edge still opens the edge-label editor. | US2 AS4, FR-017, edge case |
| 9 | Confirm the analogy | "Confirmed". The outline and pipe turn solid. There is one `confirmed` event with `user_confirmed`. | US3 AS1 |
| 10 | Run Analogy on a second node and reject it | It disappears from the map. Its node, pipe, version and `rejected` event are still in the database. "Show rejected" draws it faded. | US3 AS2, FR-027, FR-037 |
| 11 | Leave a third analogy untouched and reload later | It is still "Proposed", `ai_suggested`. | US3 AS3, FR-028 |
| 12 | Send another message in the source so its summary regenerates | The confirmed analogy shows the stale pill on the map and "Made from an older summary" in its view. The fake's `completeInputs` count is unchanged, and no version was added. | US4 AS1, AS2, FR-022, FR-024, SC-003, SC-004 |
| 13 | Press Regenerate on the confirmed, stale analogy | A second version (`ai_suggested`) appears as a draft. The displayed text is still the confirmed one, and the stale pill is gone. "Use this version" then makes it the displayed, confirmed text. Both versions are kept. | US4 AS3, AS4, FR-025, FR-026, SC-005 |
| 14 | An output whose source summary didn't change | No stale pill. | US4 AS5 |
| 15 | Settings: set Analogy "Length" to "One sentence" | Saved. No run happens (fake call count unchanged). A new run records `settings.length = "one_line"`, and the fake prompt contains the one-sentence instruction. | US5 AS1, AS2, AS5, FR-032, SC-008 |
| 16 | On one analogy, set its Length override to "Paragraph", then regenerate it and a second analogy | Only the overridden one records `paragraph`. Its view shows "Overriding…". Clearing the override returns it to the kind value. | US5 AS3, AS4, FR-030, FR-031 |
| 17 | Drag an analogy | It moves alone and the pipe follows. The pipe row is unchanged, and other trees and hand-placed nodes don't move. | FR-039, edge case |
| 18 | `POST /api/nodes/{analogyId}/messages` and `/branches` | 409 `wrong_kind`. | FR-005 |
| 19 | Register a test-only function (reads `anchor`) and a test-only kind in a test | The function runs through the unchanged runner. The kind's settings section renders from its declaration. | SC-006, SC-007 |
| 20 | `npm run seed:large`, add 50 analogies, open the map and double-click a node | The map opens and the view opens within 1 s. | SC-009 |
