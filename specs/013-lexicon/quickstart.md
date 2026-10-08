# Quickstart: validating Farabi Lexicon

Prerequisites: worktree `.env.local` points at `farabi_lexicon` / `farabi_lexicon_test`
(never the owner's `farabi`). `npm ci`, then `npm run db:migrate` (check the URL first).

## Automated
- `npx vitest run` — registry checks (`tests/unit/f13-registry.test.ts`), block and selection rules
  (`f13-block`, `f13-selection`), output checks (`f13-checks`), method prompts (`f13-methods`), and
  integration (`tests/integration/f13-lexicon.test.ts`, `f13-methods.test.ts`).
- `npx tsc --noEmit && npx eslint .`
- Playwright on port 3113 with the lane DB: `tests/e2e/f13-lexicon.spec.ts`.

## Manual (fake provider)
1. `AI_PROVIDER=fake npm run dev -- -p 3113`, open a project.
2. Composer → Terms → type "dist" → Enter. A Distill chip appears; hover it: the card shows
   "Sent to the model" with v1 and the instruction.
3. Try adding Comprehensive: it is listed as unavailable ("Conflicts with Distill").
4. Send "What is a pod?". The question bubble shows a Distill chip; the stored text is unchanged.
5. On the answer, ƒ → Premortem: a proposed Premortem output appears under a function edge.
6. `npm run lexicon:doc | head` prints the lexicon grouped by slot.

## Real provider (owner's go-ahead needed: spends calls)
Send the same question with and without Distill / Table and compare; `runCheck("table", reply)`
should pass with Table.
