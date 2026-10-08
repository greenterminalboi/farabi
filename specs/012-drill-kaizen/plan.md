# Implementation Plan: Drill Kaizen

**Branch**: `012-drill-kaizen` (worktree `/Users/halda/Projects/farabi-012-drill`) | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/012-drill-kaizen/spec.md`

## Summary

A drill is a small tree in the v0.2 message graph, and only its drill node is drawn on the canvas.

- **Storage.** Lessons, problems, hints, solutions, attempts and verdicts are `nodes` of new kinds
  marked `onCanvas: false`. An attempt is a user-authored edge and a verdict is an AI node under it,
  the same pair as question → answer. This means:
  - immutability, provenance and "nothing deleted" come from v0.2's `nodes_guard`
  - Branch, Define and Park on drill text use the existing routes
  - a follow-up is an ordinary question edge under the verdict, so its context (domain → problem →
    attempt → verdict) comes from the ancestor path
- **Mutable state.** The ladder, levels, round ends, problem events, verdict overrides, attachments
  and the completion offer live in append-only `drill_*` tables (migration 0011).
- **Progression.** Pure functions turn a round's results into level changes, open the next rung and
  mark rungs solid, all automatically, and every change cites its attempts.
- **AI work.** Five declared operations (ladder, round, verdict, offer, domain) run through a
  generic call, extract and validate executor. They use the user's reply model.
- **The drill screen.** A DOM page at `/drill/:id` showing one problem at a time. It reuses v0.2's
  text pipeline, so selection works.

## Technical Context

**Language/Version**: TypeScript 6 on Node 24, the same as v0.2.

**Primary Dependencies**: Next 16 App Router, React 19, zustand 5, Kysely and pg, zod 4. The canvas
is v0.2's PixiJS plus DOM text layer. **No new packages.**

**Storage**: PostgreSQL 17. Migration `0011_drill.ts` adds 8 append-only tables and `'drill'` to the
`nodes.origin` CHECK. See [data-model.md](./data-model.md). The registration in `migrationList.ts`
is done by the coordinator (C7). If the Tauri lane changes the engine, it must log that first, per
STATUS.md.

**Testing**: Vitest (unit and integration, fake provider with per-tag responders, R16) and
Playwright. New suites are `f12-*`. `constitution.test.ts` gains append-only guards for the
`drill_*` tables.

**Target Platform**: local web app on 127.0.0.1, desktop Chromium-class browser, single user.

**Project Type**: the existing single Next.js web application.

**Performance Goals**:

- SC-004: a verdict within 15 s, p95, using `effort: low`.
- Round generation is not a target, but shows progress.
- Drill screen load under 500 ms for a drill of 30 rounds (about 500 hidden elements).
- The canvas ignores hidden kinds, so v0.2's 5,000-element budget is unaffected.

**Constraints**:

- No DELETE or PATCH routes.
- No AI call without a user action (FR-027).
- Every AI write happens after the AI call (the attempt is stored first by design).
- No changes to v0.2's runner (SC-013 guard).
- Cross-lane changes are limited to C1–C7 (research R15) and logged before they are made.

**Scale/Scope**: 1–20 rungs, 1–10 problems per round, tens of rounds per drill, a few drills per
project.

## Constitution Check

*Gate: checked before Phase 0 and re-checked after Phase 1.* Constitution version 1.0.1.

| Article | Result |
|---------|--------|
| I. User is final authority | **PASS.** The domain, attempts, ladder edits, overrides and manual levels are `user_authored`. Ladders, lessons, problems, verdicts, offers and automatic level changes are `ai_suggested`, carry the AI tag, and are never relabelled. An override or manual level always wins in progression. Automatic stepping applies ai-suggested changes for flow, which the owner chose (spec clarification), and every one is recorded as AI-made and can be reversed by the user. |
| II. Additive growth | **PASS.** Every `drill_*` table is append-only by trigger, and drill elements are guarded by `nodes_guard`. A replaced problem, a new attempt or a recompute adds rows. A recompute supersedes in the note but never rewrites. There are no delete routes. |
| III. Nothing invented ahead of evidence | **PASS, with a note.** Lessons and problems come from general knowledge, but the user explicitly requested them as practice material. They are marked AI-generated and never claim anything about the user's map. The ladder order is an editable proposal, not a coupling between the user's nodes. Levels move only on the user's attempts. Offers draw only on the user's own follow-ups and attached conversations. |
| IV. User-led exploration | **PASS.** Drills start only from the user. The single AI-initiated surface is the completion offer: once per drill, at most 3 items, dismissible, and it creates nothing by itself. A drill never blocks the canvas. |
| V. Compression preserves meaning | **PASS.** The card and round notes are derived from rows that link to full attempts, verdicts and problems. |
| VI. History is data | **PASS.** Progression reads only recorded attempts, verdicts and overrides, never a self-rating. Thresholds are explicit user settings about the drill's form (the Article VI clarification in 1.0.1), not inferred personalization. |

**Post-design re-check**: PASS, and Complexity Tracking is empty. Owner flags (spec deviations, not
constitution issues):

- **R12**: the "link to parent drill" is shown as a label on the card when the source is in another
  tree, because v0.2 has no cross-tree connectors.
- **R13**: Branch, Define and Park cover element text, not rung names.
- **R3**: a follow-up is drawn from the drill node but stored under the verdict it asks about.

## Project Structure

### Documentation (this feature)

```text
specs/012-drill-kaizen/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R17
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── http-api.md      # drill routes; follow-ups reuse v0.2 routes
│   ├── declarations.md  # registry additions, drill kinds, operations
│   └── drill-ui.md      # drill screen, canvas card, test hooks
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
# Drill lane (owned)
src/server/db/migrations/0011_drill.ts          NEW tables, triggers, origin CHECK
src/server/db/schema.ts                         + drill table types (append to v0.2's Database)
src/shared/kinds/drill/{start,drill,round,lesson,problem,hint,solution,attempt,verdict}.ts   NEW declarations
src/server/drill/operations/{types,call,ladder,round,verdict,offer,domain,fakes}.ts          NEW (R4, R5, R16)
src/server/drill/progression.ts                 NEW pure progression + round plan (R7)
src/server/drill/{create,ladder,start,rounds,attempts,events,overrides,levels,attachments,offers,load}.ts   NEW services
src/server/drill/results.ts                     NEW derived results, current problem, round note
src/app/api/drills/…, drill-rounds/…, drill-problems/…, drill-attempts/…, drill-verdicts/…, drill-offers/…   NEW routes
src/app/drill/[drillId]/page.tsx                NEW drill screen
src/drill/{DrillScreen,Ladder,ProblemView,RoundStrip,LessonView,FailedList,OfferCards,CreateDrillForm,store}.tsx  NEW client
src/shared/schemas.ts                           + drill section (append-only edit)

# Cross-lane, additive, logged first (research R15)
src/shared/kinds/{types,index,question,answer}.ts   C1 onCanvas, contextRole, display "drill"
src/server/graph/context.ts                         C2 roles instead of literal kinds
src/server/graph/canvas.ts, src/canvas/…            C3 hidden kinds, drawnFrom, drill card, New drill entry
src/server/ai/{provider,claude,claudeCode,fake}.ts  C4 model/effort/maxTokens, C5 fake responders
src/server/settings/kindSettings.ts                 C6 overrides on any element
src/server/db/migrationList.ts                      C7 (coordinator)

# Tests
tests/unit/f12-{progression,operations,results,registries}.test.ts
tests/integration/f12-drill.test.ts, f12-followups.test.ts; constitution.test.ts (+ drill guards)
tests/e2e/f12-us{1..6}-*.spec.ts
```

**Structure Decision**: The drill is a module of the single Next.js app, following v0.2's layout:

- `src/server/drill/` for services, operations and progression
- `src/shared/kinds/drill/` for declarations
- `src/drill/` for the client screen, a sibling of `src/canvas/`
- `src/app/drill/` and `src/app/api/drill*` for routes

### Delivery milestones (input to /speckit-tasks)

| Milestone | Delivers | Needs | Exit check |
|-----------|----------|-------|------------|
| **D0 Pure core** | progression, round plan, results, operations and executor, fakes | nothing (can start now, on bbd6930) | `f12-progression`, `f12-operations`, `f12-results` green |
| **D1 Data and server** (P1 stories 1–3) | 0011, drill kinds (C1 subset), C4, C5, services, routes | v0.2 M1 and M2 committed, and a rebase | `f12-drill` integration, constitution guards |
| **D2 Drill screen** (P1 stories 1–3, P2 story 4) | screen, ladder editing, one problem at a time, round strip, notes, failed list, resume | D1 | e2e us1–us4 |
| **D3 Canvas and follow-ups** (P2 story 5) | C1 rest, C2, C3, follow-up box, Branch/Define/Park on drill text | v0.2 M3 and M4 | e2e us5, `f12-followups` |
| **D4 Grounding and drill-on** (P3 story 6) | C6, settings, attachments, completion offer, drill from a starting point | v0.2 M6 | e2e us6, quickstart §3 |
| **D5 Hand-off** | README section, quickstart run with a real provider, STATUS log, merge request to the coordinator | all | full suite green |

## Complexity Tracking

None. No constitution violations need justification.
