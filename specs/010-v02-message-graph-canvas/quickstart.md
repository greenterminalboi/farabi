# Quickstart: Validating Farabi v0.2

Run guide proving the feature end to end. Shapes are in [contracts/](./contracts/) and
[data-model.md](./data-model.md).

## Prerequisites

- Docker running, with `docker compose up -d`
- `.env.local` with `DATABASE_URL`, `TEST_DATABASE_URL` and `AI_PROVIDER=fake` for the scripted
  checks
- `npm install`

## 0. Scale proof first (milestone M0, research R17)

```bash
NEXT_PUBLIC_FARABI_TEST_HOOKS=1 FARABI_TEST_HOOKS=1 npm run build && npm start
# open http://127.0.0.1:3000/dev/canvas-spike?n=5000
npx playwright test tests/e2e/f10-m0-spike.spec.ts
```

**Expected**:

- Pan p95 is under 16.7 ms, and zoom-step p95 is under 20 ms.
- The first render completes in under 1 s.
- Selecting a phrase at the furthest zoom opens the toolbar.
- `offscreenMounted` is 0.

Record the numbers in research.md R17 before going further.

## 1. Migrate a copy of real data (story 4)

```bash
npm run db:migrate          # backs up to db/backups/<time>-pre-0010.dump, then runs 0010 + conversion
npm run v1:verify           # text, context, counts, checksums
npm run v1:convert          # rerun: must report 0 new rows
```

**Expected**:

- The migrate step prints counts per rule, for example "67 messages → 33 edges + 34 answers".
- `v1:verify` prints `OK` for every invariant in
  [contracts/migration.md](./contracts/migration.md#invariants-checked-by-v1verify-and-by-the-integration-test-on-fixtures).
- The rerun inserts 0 rows.
- To try this without touching real data, restore the dump into a scratch database first:
  `docker compose exec -T db createdb farabi_copy`, then `pg_restore`, then point `DATABASE_URL`
  at it.

## 2. Automated suites

```bash
npm run typecheck && npm run lint
npm test                    # unit + integration (fake provider)
npx playwright test         # e2e on the production build with GPU Chromium
```

The key new files:

| File | What it covers |
|------|----------------|
| `tests/unit/f10-layout.test.ts` | Columns, right fan-out, contours, hand placement, other trees untouched (SC-009) |
| `tests/unit/f10-budget.test.ts` | Proportional character budget, 24-character floor, pinning |
| `tests/unit/f10-camera.test.ts` | Follow and free state machine; no moves from other events (SC-008) |
| `tests/unit/f10-richtext.test.ts` | Markdown to blocks and runs with exact source offsets, and the clipping cut points |
| `tests/unit/f10-selection.test.ts` | `selectionToAnchor` on `data-node-id` roots and clipped items |
| `tests/integration/v1-convert.test.ts` | Every rule and invariant of the migration contract |
| `tests/integration/f10-graph.test.ts` | Ask, branch, `????`, unsent send, retry and regenerate siblings, notes, positions, context path (FR-007) |
| `tests/integration/f10-functions.test.ts` | Run, rerun, confirm, reject, failed run writes nothing, settings override, SC-013 |
| `tests/integration/constitution.test.ts` | `nodes_guard` refuses every illegal update and all deletes; no `v1` access outside the converter; only `messages/` calls `reply(`; nobody calls `summarize(` (SC-014); every AI-made element is `ai_suggested` (SC-015) |
| `tests/e2e/f10-*.spec.ts` | One spec per user story (below) |
| `tests/e2e/f10-scale.spec.ts` | 5,000-element canvas via `npm run seed:large -- --test --elements 5000`: open < 1 s, pan and zoom p95, minimap < 100 ms (SC-005, SC-012) |

The carried-over suites for definitions, feedback, projects, parking and settings are adapted
and must pass (SC-016).

## 3. Manual walk-through on the dev server

`npm run dev`, then open http://127.0.0.1:3000.

1. **Story 1.** Open an empty project and type a question. An origin bubble appears, then an
   answer card streams below it while the camera glides along. Send a follow-up from the answer
   composer and the column extends. Send again from the same answer and a sibling edge fans right.
2. **Story 2.** Zoom out until the whole tree is a few pixels tall. Text is still there, clipped,
   and dragging across a visible word opens Define, Branch and Park. Zoom in and more text
   appears. Select a phrase, pan it off-screen and back: the selection survives.
3. **Story 3.**
   - Branch from a phrase in an answer, then from a phrase in your own bubble. Each makes a dashed
     unsent bubble with the composer preloaded.
   - Send `????` from an answer, and a sibling re-ask fans out and starts replying.
   - Park a phrase with a question and click it in the Parked tab. It fires.
4. **Story 5.**
   - Press `Alt+↑` and `Alt+↓`, and the camera follows.
   - Wheel-pan away, and the camera stays put while a reply finishes elsewhere.
   - Click and drag in the minimap.
   - Reload, and the camera is where you left it.
5. **Story 6.**
   - Drag an answer by its frame. Only it moves.
   - Alt-drag to move the tree, then reload: both positions hold.
   - Click a question bubble's connector chip, add a note, then clear it.
6. **Story 7.** Regenerate an answer that has a branch. A sibling answer appears, and the branch
   stays on the original.
7. **Story 8.**
   - Use `ƒ`, then Analogy, on an answer. A dashed function connector and an AI-tinted card
     appear.
   - Confirm it, run again, and reject the second output. It hides, and appears again with "Show
     rejected".
   - Change Analogy's reach in Settings. Nothing runs.
8. **Story 9.**
   - A collected term is underlined in every mounted text, and the hover card works.
   - Feedback submitted while an element is focused records it.
   - Switching project switches the canvas, and a reply in progress in the other project finishes.

## 4. Rollback (if ever needed)

Restore the backup:

```bash
docker compose exec -T db pg_restore --clean -d farabi < db/backups/<time>-pre-0010.dump
```

The `v1` schema also holds every original row in place.
