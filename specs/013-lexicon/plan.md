# Implementation Plan: Farabi Lexicon

**Branch**: `013-lexicon` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/013-lexicon/spec.md`

## Summary

A shared lexicon registry (`src/shared/lexicon/`) holds about 70 versioned terms as JSON data, one
file per slot, validated at load and locked by a version file. The composer gains term chips, a
searchable picker and a hover card, all driven by the shared registry and its selection rules
(one value per single slot, declared conflicts, six at most). The server checks the same rules,
records `{id, v}` uses in the question edge's declared properties and in each answer's, and the
reply builder appends one `<lexicon>` block after the stable system prompt. Three methods
(Premortem, Steelman, SCQA) are new output kinds plus function definitions beside Analogy; the
runner is untouched. One small migration (0013) lets the "send" of an unsent edge set its
properties once, so terms can ride on branch and parked edges too.

## Technical Context

**Language/Version**: TypeScript 5 (strict), Node 22

**Primary Dependencies**: Next.js 16 (App Router, route handlers), React 19, Zustand, Zod 4, Kysely, pg

**Storage**: PostgreSQL (nodes.properties JSONB, already declared per kind); PGlite in the desktop lane, same SQL

**Testing**: Vitest (unit + integration on the lane DB `farabi_lexicon_test`), Playwright e2e on port 3113

**Target Platform**: Local web app (desktop shell in feature 011)

**Project Type**: Web application (single Next.js project)

**Performance Goals**: Picker filtering and chip rendering feel instant (< 16 ms for 70 terms); no change to canvas frame budgets

**Constraints**: Message text verbatim (Article I); no auto-detection; cached system prefix unchanged; runner unchanged (SC-013); shared-file edits additive and logged in STATUS.md

**Scale/Scope**: 69 base terms, 3 methods, 1 migration, ~6 new client components/modules

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Article | Gate | Status |
|---------|------|--------|
| I | Terms only by explicit chip; text verbatim; exact instruction visible before send; method outputs ai-suggested + reviewed | PASS |
| II | Uses fixed at send; retries/re-asks add new rows; terms retired, never deleted; properties set once (migration keeps the guard otherwise intact) | PASS |
| III | Instructions shape output form (explicit-instruction carve-out); methods read only the answer text and are marked AI | PASS |
| IV | No AI-initiated term or method suggestions; picker opens on request | PASS |
| V | Scope instructions name what to keep; every reply traces to term versions | PASS |
| VI | Uses recorded on edge and answer; never used as learning evidence | PASS |

Post-design re-check (after Phase 1): PASS, no violations; Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/013-lexicon/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── dictionary-extract.md   # verbatim source rows for the base set
├── contracts/
│   ├── registry.md         # the shared lexicon contract (new, beside kinds)
│   ├── http-api.md         # terms on start/ask/send; lexicon on Element
│   ├── prompt.md           # the <lexicon> block
│   └── composer-ui.md      # chips, picker, card, canvas row
└── tasks.md
```

### Source Code (repository root)

```text
src/shared/lexicon/            # NEW shared contract
├── types.ts                   # Slot, Term schema, TermUse, LexiconUses
├── data/{operation,scope,format,tone,audience,strength,quality}.json
├── data/versions.lock.json    # id → version + instruction hash
├── index.ts                   # registry, search, availability, checkSelection
├── block.ts                   # lexiconBlock(): the exact text sent
└── checks.ts                  # code checks for observable effects
src/shared/kinds/{question,answer}.ts          # + optional `lexicon` property (additive)
src/shared/kinds/{premortem,steelman,scqa}.ts  # NEW output kinds
src/shared/schemas.ts                          # + optional terms on requests, lexicon on Element
src/server/lexicon/resolve.ts                  # NEW: validate ids → uses; uses → texts
src/server/graph/{ask,quickBranch,elements,context}.ts  # pass/record/read uses (additive)
src/server/answers/generation.ts               # answer records the uses it sends
src/server/ai/{provider,claudePrompts}.ts      # ReplyInput.lexicon?; block after the prefix
src/server/functions/definitions/{premortem,steelman,scqa}.ts + index.ts
src/server/db/migrations/0013_lexicon.ts + migrationList.ts
src/app/api/{trees,nodes/[nodeId]/ask,edges/[edgeId]/send}/route.ts  # pass terms
src/lib/api.ts                                 # optional terms argument
src/canvas/store.ts                            # draftTerms per target (persisted)
src/canvas/overlays/Composer.tsx               # chips row + picker trigger
src/canvas/overlays/lexicon/{TermChips,TermPicker,TermCard}.tsx  # NEW
src/canvas/{scene,geometry}.ts                 # terms row on sent question bubbles
src/app/globals.css                            # appended lexicon section
scripts/lexicon-{lock,doc}.ts                  # version lock + doc view export
tests/unit/f13-*.test.ts, tests/integration/f13-*.test.ts, tests/e2e/f13-*.spec.ts
```

**Structure Decision**: Single Next.js project, following the existing split: shared declarations
in `src/shared`, server logic in `src/server`, canvas overlays in `src/canvas/overlays`.

## Shared-file edits (logged in STATUS.md before making them)

All additive: `src/shared/kinds/{question,answer,index}.ts` (+3 kinds, optional property),
`src/shared/schemas.ts` (optional fields), `src/server/graph/context.ts` (read answer uses),
`src/server/ai/provider.ts` (optional `lexicon`), `src/server/ai/claudePrompts.ts` (block after
length guidance), `src/canvas/overlays/Composer.tsx` (chips), `src/canvas/{scene,geometry}.ts`
(terms row), `src/server/db/migrationList.ts` (+0013), migration 0013 replacing `nodes_guard()`
with one extra allowed case.

## Complexity Tracking

None.
