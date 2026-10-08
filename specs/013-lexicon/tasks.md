---
description: "Task list for Farabi Lexicon (feature 013)"
---

# Tasks: Farabi Lexicon

**Input**: Design documents from `specs/013-lexicon/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Requested by the spec (FR-019, FR-020): registry, block, selection, checks, integration
and e2e tests are included.

**Format**: `[ID] [P?] [Story] Description`. All paths are relative to the worktree root.

## Phase 1: Setup

- [X] T001 Confirm the lane DB: worktree `.env.local` has `DATABASE_URL=…/farabi_lexicon` and `TEST_DATABASE_URL=…/farabi_lexicon_test`; baseline `npx vitest run` green (310)
- [X] T002 Log planned shared-file edits and migration 0013 in `/Users/halda/Projects/farabi-coord/STATUS.md` before touching them

## Phase 2: Foundational (blocks every story)

- [X] T003 Define `Slot`, `SLOT_ORDER`, `SINGLE_SLOTS`, `MAX_TERMS = 6`, the strict Zod `Term` schema (id `^[a-z0-9]+(-[a-z0-9]+)*$`; instruction "≤ 400 chars; no `<` or `>`"; version int ≥ 1; optional `check`, `retired`) and `TermUse`/`LexiconUses` (max 6, unique ids) in `src/shared/lexicon/types.ts`
- [X] T004 [P] Write the operation terms (26: summarize, distill, condense, expand, rewrite, polish, proofread, critique, compare, analyze, synthesize, extract, categorize, rank, brainstorm, draft, outline, explain, simplify, diagnose, evaluate, abstract, instantiate, invert, reframe, steelman) with meanings/examples from `specs/013-lexicon/dictionary-extract.md` in `src/shared/lexicon/data/operation.json`
- [X] T005 [P] Write the scope (8) and format (6) terms in `src/shared/lexicon/data/scope.json` and `src/shared/lexicon/data/format.json`
- [X] T006 [P] Write the tone (5) and audience (5) terms in `src/shared/lexicon/data/tone.json` and `src/shared/lexicon/data/audience.json`
- [X] T007 [P] Write the strength (11) and quality (8) terms in `src/shared/lexicon/data/strength.json` and `src/shared/lexicon/data/quality.json`
- [X] T008 Implement the registry (`allTerms`, `activeTerms`, `findTerm`, `roleOf`, `sortBySlot`, `searchTerms`, `unavailableReason`, `checkSelection`) loading and validating all data files, failing loudly on a bad file, in `src/shared/lexicon/index.ts`
- [X] T009 Implement `lexiconBlock()` exactly per contracts/prompt.md in `src/shared/lexicon/block.ts`
- [X] T010 [P] Implement code checks (`bulleted`, `numbered`, `table`, `checklist`, `tldr-first`, `pros-cons`, `max-words-one-pager`) and `runCheck` in `src/shared/lexicon/checks.ts`
- [X] T011 Write `scripts/lexicon-lock.ts` (rewrites `src/shared/lexicon/data/versions.lock.json`; refuses a changed instruction hash without a version increase) and add `lexicon:lock` to `package.json`; generate the lock
- [X] T012 [P] Unit tests: schema validity, ≥ 65 active terms, unique ids and case-insensitive names/aliases, slot matches file, neighbours exist and aren't self, conflicts exist and are symmetric, instruction form, every `check` id exists, lock matches, in `tests/unit/f13-registry.test.ts`
- [X] T013 [P] Unit tests for `checkSelection`/`unavailableReason` (same single slot, conflict, seventh term, unknown, retired, duplicate, multi-value slots) and `searchTerms` (alias match, prefix first) in `tests/unit/f13-selection.test.ts`
- [X] T014 [P] Unit tests for `lexiconBlock` (slot order then id, escaping, null for none) and `runCheck` fixtures (pass and fail per check) in `tests/unit/f13-block.test.ts`

**Checkpoint**: the registry is usable from server and client.

## Phase 3: User Story 1 - Add term chips to a message (P1) 🎯 MVP

**Goal**: chips on a draft are sent as `terms`, recorded on the edge and answer, and reach the reply as one `<lexicon>` block; the text stays verbatim.

**Independent test**: send a message with two chips; stored text unchanged, edge and answer record `{id, v}`, the fake provider's ReplyInput has exactly those terms and `buildReplyRequest` has the block last.

- [X] T015 [US1] Add optional strict `lexicon: LexiconUses` to the `properties` of `src/shared/kinds/question.ts` and `src/shared/kinds/answer.ts`
- [X] T016 [US1] Add optional `terms: z.array(z.string()).max(6)` to `StartTreeRequest`, `AskRequest`, `SendRequest`, and optional `lexicon` (array of `{id, v}`) to `Element` in `src/shared/schemas.ts`
- [X] T017 [US1] Write migration `src/server/db/migrations/0013_lexicon.ts` (CREATE OR REPLACE `nodes_guard()` = 0010's, except properties may change once in the send transition when `OLD.properties = '{}'`; down restores 0010's) and register `"0013_lexicon"` in `src/server/db/migrationList.ts`
- [X] T018 [US1] Implement `resolveTerms(ids)` (checkSelection → `TermUse[]`, 422 InvalidRequestError with the reason) and `usesToTexts(uses)` in `src/server/lexicon/resolve.ts`
- [X] T019 [US1] Record uses: `startTree`, `insertAsk`, `ask`, `sendUnsent` take optional term ids and store `properties.lexicon` (send sets it with text) in `src/server/graph/ask.ts`; quick-branch copies the re-asked edge's uses in `src/server/graph/quickBranch.ts`
- [X] T020 [US1] `insertPendingAnswer` records the edge's term ids at current versions on the answer in `src/server/answers/generation.ts`; `toElement` exposes `lexicon` in `src/server/graph/elements.ts`
- [X] T021 [US1] Pass `terms` from the three routes: `src/app/api/trees/route.ts`, `src/app/api/nodes/[nodeId]/ask/route.ts`, `src/app/api/edges/[edgeId]/send/route.ts`
- [X] T022 [US1] Add optional `ReplyInput.lexicon` in `src/server/ai/provider.ts`; `buildReplyInput` reads the answer's uses into it in `src/server/graph/context.ts`; `buildReplyRequest` appends `lexiconBlock` as the last system block in `src/server/ai/claudePrompts.ts`
- [X] T023 [P] [US1] Unit test: `buildReplyRequest` without lexicon is byte-identical to before; with lexicon the block is last and the messages are unchanged; headless form contains it, in `tests/unit/f13-prompt.test.ts`
- [X] T024 [P] [US1] Integration tests (start/ask/send with terms, verbatim text, edge + answer uses, fake ReplyInput.lexicon, retry/regenerate records current versions, quick-branch copies uses, 400 on invalid selections with nothing stored, no terms → no property) in `tests/integration/f13-lexicon.test.ts`
- [X] T025 [US1] Client: `draftTerms` per target persisted with drafts, `setDraftTerms`, in `src/canvas/store.ts`; optional `terms` on `api.startTree/ask/sendUnsent` in `src/lib/api.ts`
- [X] T026 [US1] Picker: searchable, grouped listbox, keyboard (arrows, Enter, Escape), unavailable entries with reasons, in `src/canvas/overlays/lexicon/TermPicker.tsx`
- [X] T027 [US1] Chip row with remove buttons in `src/canvas/overlays/lexicon/TermChips.tsx`; wire chips + "Terms" button into `src/canvas/overlays/Composer.tsx` (send passes ids; chips clear with the draft)
- [X] T028 [US1] Canvas: a footer row of `.lexicon-chip` parts on sent question bubbles with uses (tooltip with slot, version, instruction) in `src/canvas/scene.ts`; bubble height accounts for it in `src/canvas/geometry.ts`; styles appended to `src/app/globals.css`

**Checkpoint**: MVP: terms work end to end.

## Phase 4: User Story 2 - See what a term will do (P1)

**Goal**: hover/focus card with role, slot, meaning, example, neighbours, version and exact instruction; swap and remove.

**Independent test**: hover a chip; the card's instruction equals the term's instruction in the block.

- [X] T029 [US2] Card (role="tooltip", ~300 ms hover delay, stays while hovered, Escape closes, opens on focus) with neighbour swap buttons and their unavailable reasons in `src/canvas/overlays/lexicon/TermCard.tsx`
- [X] T030 [US2] Show the card from chips (with Swap/Remove) and from picker options (read-only) in `src/canvas/overlays/lexicon/TermChips.tsx` and `src/canvas/overlays/lexicon/TermPicker.tsx`

## Phase 5: User Story 3 - Slot rule and conflicts (P2)

**Goal**: blocked combinations are unavailable in the picker with the reason, and refused by the server.

**Independent test**: Concise then Comprehensive → unavailable; six chips → all unavailable; direct API call → 400.

- [X] T031 [US3] *(cap removed by T040)* Six-term notice and disabled state in the picker; swap respects `unavailableReason` in `src/canvas/overlays/lexicon/TermPicker.tsx` (server half covered by T018/T024)

## Phase 6: User Story 4 - Run a method on an answer (P2)

**Goal**: Premortem, Steelman, SCQA in the function menu, run like Analogy.

**Independent test**: run each on an answer with the fake provider; output of that kind under a function edge, proposed, version 1.

- [X] T032 [P] [US4] Output kinds `premortem`, `steelman`, `scqa` (shape node, display output, `acceptsInputKinds: ["answer"]`, settings `[]`, strict empty properties) in `src/shared/kinds/premortem.ts`, `src/shared/kinds/steelman.ts`, `src/shared/kinds/scqa.ts`; register in `src/shared/kinds/index.ts`
- [X] T033 [P] [US4] Function definitions (version 1, procedure propose, grounded in the answer text, parse trims and refuses empty) in `src/server/functions/definitions/premortem.ts`, `steelman.ts`, `scqa.ts`; register in `src/server/functions/definitions/index.ts` (runner untouched)
- [X] T034 [P] [US4] Unit tests for the method prompts (text escaped, grounding sentence present, parse) in `tests/unit/f13-methods.test.ts`; integration test (listed for answers only, run creates function edge + proposed output, failure stores nothing) in `tests/integration/f13-methods.test.ts`

## Phase 7: User Story 5 - The lexicon as a readable document (P3)

- [X] T035 [US5] `scripts/lexicon-doc.ts` printing markdown grouped by slot (all fields, retired marked) and `lexicon:doc` in `package.json`; a unit test that every active term appears once in `tests/unit/f13-doc.test.ts`

## Phase 8: Polish & cross-cutting

- [X] T036 E2E on port 3113 with the lane DB: add a chip by keyboard, see the card's sent text, blocked conflict, send → bubble shows the chip and stored text is unchanged, run Premortem, in `tests/e2e/f13-lexicon.spec.ts`
- [X] T037 [P] README: a short "Lexicon" section (chips, adding a term, lock, doc export) in `README.md`
- [X] T038 Full `npx vitest run`, `npx tsc --noEmit`, `npx eslint .`, Playwright on a private port (3123: 3113 was taken by the drill lane); commit in logical chunks
- [X] T039 Hand-off line in `/Users/halda/Projects/farabi-coord/STATUS.md` (commits, test counts, shared-file edits, owner questions)

## Phase 9: Auto-detect (owner decision 2026-10-07)

"Pick up any lexicon words at the moment and have a setting to turn them down." Supersedes the
chip-only activation and the hard six-term cap (spec Clarifications).

- [X] T040 Remove the hard cap: `MAX_TERMS` → `SOFT_TERM_LIMIT = 8` (warning only); `LexiconUses` and the request schema lose their maximum; `unavailableReason` no longer counts, in `src/shared/lexicon/{types,index}.ts`, `src/shared/schemas.ts`, `TermPicker.tsx`
- [X] T041 `TermUse` gains optional `via: "detected" | "chip"`; requests take `string | { id, via }`; `resolveTerms` records via on the edge (bare id = chip), answers keep `{ id, v }`, in `src/shared/lexicon/types.ts`, `src/shared/schemas.ts`, `src/server/lexicon/resolve.ts`, `src/server/graph/ask.ts`, `src/lib/api.ts`
- [X] T042 Detection and composition in `src/lib/lexiconDetect.ts` (reuses `buildMatcher`): whole words, any case, curly apostrophes, no stemming, "can" excluded; manual chips first, then detected in text order; clashes become suggestions; dismissed and swapped-in ids per draft
- [X] T043 App setting `lexicon_autodetect` (default on, no env) in `src/server/settings/config.ts`, `src/shared/desktop.ts`, `src/server/db/schema.ts`, migration `0014_lexicon_autodetect`; Settings → Lexicon checkbox in `AppSettingsSections.tsx`; passed from `src/app/page.tsx` through `CanvasHost` to the composer
- [X] T044 Composer: detected chips (dashed, "detected"), dismiss that sticks for the draft, "conflicts with X" suggestions with swap/dismiss, soft warning above 8, `draftLexicon` persisted in `src/canvas/store.ts`; `TermChips.tsx`, `Composer.tsx`, `globals.css`
- [X] T045 Tests: unit `tests/unit/f13-detect.test.ts` (boundaries, aliases, punctuation, plurals, apostrophes, longest match, composition) and the updated cap test; integration `via` recording on trees/ask/send, old rows, no cap, slot/conflict refusals, the setting (default, history, boolean-only, DB check) in `tests/integration/f13-lexicon.test.ts`; e2e detect → swap → dismiss → send, and setting off, in `tests/e2e/f13-lexicon.spec.ts`

## Dependencies

- Phase 2 blocks everything. US1 (T015–T028) blocks US2 and US3 (they extend the picker and chips).
- US4 (T032–T034) depends only on Phase 1; it can run in parallel with US1.
- US5 depends only on Phase 2.
- T036 needs US1–US4.

## Parallel examples

- Phase 2: T004, T005, T006, T007 (data files) together; then T010, T012–T014 together.
- US1: T023 and T024 while T025–T028 (client) are written.
- US4: T032, T033, T034 alongside US1.

## Implementation strategy

MVP is Phase 2 + US1: terms recorded and sent. Then US2 (the card) and US3 (picker rules polish),
US4 methods, US5 export, and the e2e pass. Commit after Phase 2, after US1 server, after US1–US3
client, after US4, after polish.
