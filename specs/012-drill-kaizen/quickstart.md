# Quickstart: Drill Kaizen

How to validate the feature end to end. Shapes are in [contracts/](./contracts/), and tables are in
[data-model.md](./data-model.md).

## Prerequisites

- The drill worktree is rebased onto v0.2, with M1 (migration 0010) and M2 (graph server) committed.
  The integration checks (§4) also need v0.2 M4 and M6 (research R17).
- `0011_drill` is in `src/server/db/migrationList.ts`. The coordinator adds it when merging. Until
  then, add it locally and don't commit it.
- Set up as in the README: `docker compose up -d`, `npm run db:migrate`, and
  `npm run db:migrate -- --test`.

## 1. Automated

```bash
npx vitest run tests/unit/f12-progression.test.ts tests/unit/f12-operations.test.ts
npx vitest run tests/integration/f12-drill.test.ts tests/integration/constitution.test.ts
npx playwright test tests/e2e/f12-*.spec.ts
```

Expected:

- **Progression**, as table tests:
  - every problem solved → level +1 per round
  - none solved → −1, never below 1
  - mixed → hold
  - a reveal counts as `not_solved`, and a hinted solve as `partly_solved`
  - rung 2 opens when rung 1 reaches level 4, and a rung turns solid at 7
  - at least ⌈n/2⌉ problems go to the newest rung, and combined problems appear only at level ≥ 5
- **Operations**: valid JSON is parsed, and invalid JSON gets one retry and then
  `AIUnavailableError`. The guard finds no operation id literals in `callOperation`.
- **Integration**:
  - SC-002 scripted run, all solved with the fake verdict `✓`: a level change per round, and 100% of
    changes cite evidence
  - SC-003: 10 rounds and no repeated normalized problem text
  - SC-005: reload after restart
  - a failed ladder call creates nothing
  - a failed verdict keeps the attempt
  - an override recomputes the round
  - no UPDATE or DELETE succeeds on any `drill_*` table
- **e2e**: stories 1–6 (list below).

## 2. Manual: the dictionary drill (stories 1–4)

1. With `AI_PROVIDER=claude-code` or `claude`, open a project and choose **New drill** with the
   domain "Python dictionaries".
   - **Expect**: a drill card on the canvas, and a drill screen with an ordered ladder that starts
     at adding entries and moves to lookups and missing keys.
2. Rename one rung, move a locked rung, then choose **Start**.
   - **Expect**: a lesson on rung 1, then one problem at a time at level 1.
3. Answer correctly, submit, and confirm a verdict with feedback that quotes your answer. Answer the
   next one wrongly, then override that verdict to *solved*.
   - **Expect**: both verdicts are visible, and yours is marked as the one that counts.
4. Finish the round.
   - **Expect**: the round note says rung 1 went 1 → 2 and lists the attempts behind it. The next
     round loads by itself.
5. Keep answering correctly until rung 1 reaches level 4.
   - **Expect**: rung 2 opens with its own lesson, and the next round is mostly rung 2 with some
     rung 1 at a higher level.
6. Restart the dev server and reopen the drill from its canvas card.
   - **Expect**: the same ladder, levels, rounds and unfinished round (SC-005).

## 3. Manual: follow-ups, attachments, completion (stories 5–6)

1. On a judged problem, type "why does `d[k]` raise but `d.get(k)` doesn't?" in the follow-up box.
   - **Expect**: a link under the problem. On the canvas, a question edge and a streaming answer
     leave the drill card, and the answer uses the problem and your attempt as context.
2. Highlight a phrase in a lesson and choose **Define**, then **Branch**.
   - **Expect**: a definition and a canvas branch. No level changes.
3. Attach a canvas conversation about dictionaries.
   - **Expect**: the next round's problems record `readAttachments`.
4. Use the ladder's manual level control to set every rung to solid, then end a round.
   - **Expect**: "Ladder complete" and up to 3 offers drawn only from your follow-ups and the
     attached conversation.
5. Choose **Drill this** on one.
   - **Expect**: the create form with a prefilled domain. After creating, a new drill card leaving
     that node on the canvas, marked "from Python dictionaries".
6. Choose **Dismiss** on the old drill's offer.
   - **Expect**: it doesn't come back, and review rounds can continue.

## 4. Failure checks

- Run with `AI_PROVIDER=fake` in fail mode for each AI step:
  - create → nothing is created, and the domain stays in the form
  - submit → the attempt stays, with "Judge again"
  - end round → the round end and level changes stay, with "Generate next round"
- Flag a problem, then **Replace**.
  - **Expect**: the flagged one stays visible and is excluded from the note, and a new problem sits
    beside it.

## e2e suites

`tests/e2e/f12-us1-start.spec.ts`, `f12-us2-attempt.spec.ts`, `f12-us3-climb.spec.ts`,
`f12-us4-resume.spec.ts`, `f12-us5-followup.spec.ts`, `f12-us6-drill-on.spec.ts`

## Measurements (T082)

| Check | Target | Result (2026-10-07) |
|-------|--------|---------------------|
| `loadDrill` for a 30-round drill (646 elements), local Postgres 17 | < 500 ms | 5–7 ms over 5 runs (`f12-drill` "performance") |
| Drill e2e suite on a production build | green | 10/10, with the full suite 54/54 |
| SC-004 verdict latency with a real provider, p95 over 20 attempts | ≤ 15 s | **Not measured yet.** Needs `AI_PROVIDER=claude-code` or `claude` and the owner's go-ahead to spend calls. |
| SC-006 owner check (§2 with a real provider) | owner judges | **Open**: for the owner. |
