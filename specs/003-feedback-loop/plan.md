# Implementation Plan: In-App Feedback Loop

**Branch**: `003-feedback-loop` | **Date**: 2026-09-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-feedback-loop/spec.md`

## Summary

A **Feedback** button in the top bar opens a drawer over any view. The drawer has a compose form
(text, freeform tags, pasted or dropped screenshots) and the full list of items, which can be
dragged into order and filtered by tag. Submitting records the current view, and the node id when a
conversation is open, entirely from local data with no AI call.

Postgres is the canonical store. It has four new tables: items, tags, attachments, and an
append-only state-event log, with triggers that forbid edits and deletes. Screenshots go to
`feedback/attachments/<item>/`. After every write, `feedback/FEEDBACK.md` is regenerated
atomically for Claude Code to read. `npm run feedback:addressed -- <id>` is the only way to move an
item from `open` to `addressed` (`ai_suggested`); only the user, in the app, can resolve or reopen
an item.

## Technical Context

**Language/Version**: TypeScript 6.0 on Node.js 24 (unchanged)

**Primary Dependencies**: unchanged: Next.js 16, React 19, Zustand, Zod, Kysely, `pg`, `tsx`.
**No new dependencies**:

- uploads use `request.formData()`;
- thumbnails are made in the browser with canvas;
- drag-to-reorder uses pointer events;
- sort keys use a small fractional-key helper (research R3, R5, R10).

**Storage**: Postgres 17 (Docker), migration `0003_feedback.ts`. Image files live on the local disk
under `FEEDBACK_DIR`, default `<repo>/feedback/`.

**Testing**: Vitest (unit tests, plus integration tests against the Postgres test database, one of
which runs the real script); Playwright (production build, `FEEDBACK_DIR=.feedback-test`).

**Target Platform**: current desktop browsers against the local server; the script runs in a
terminal on the same machine.

**Project Type**: local web application (unchanged)

**Performance Goals**:

- text-only submit under 1 s (SC-002);
- `FEEDBACK.md` updated within 1 s of a write (SC-004);
- the drawer opens and scrolls smoothly with 200 items including screenshots (SC-008).

**Constraints**:

- no AI provider is imported by any feedback code (FR-021);
- no deletes, and no edits except `rank` (FR-024, enforced by triggers);
- `addressed` can be set only by the script, and `resolved` only by the user (FR-013, FR-020);
- image files are written once and never overwritten (FR-022).

**Scale/Scope**: one user, hundreds of items, up to 10 images of up to 10 MB each per item. The
feature adds one drawer, five endpoints and two npm scripts.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Article | Gate | Pre-design | Post-design |
|---------|------|------------|-------------|
| I. User is final authority | AI output carries state; only the user confirms | PASS: FR-012, FR-013, FR-026 | PASS: `addressed` is always `ai_suggested` and `resolved` always `user_confirmed`, enforced by a check constraint. The app has no path to `addressed`; the script has no path to `resolved`. The UI shows `addressed` as a suggestion awaiting confirmation (research R9) |
| II. Additive growth | No merge, reconciliation or deletion | PASS: FR-024 | PASS: no DELETE or PATCH routes; triggers block DELETE on all four tables and UPDATE on everything except `feedback_items.rank`; files are opened with `wx` (R5, R8) |
| III. Nothing invented ahead of evidence | No AI-originated content | PASS: zero in-app AI (Assumptions) | PASS: no feedback module imports `src/server/ai`, and a guard test checks this |
| IV. User-led exploration | AI suggestions stay quiet | PASS | PASS: the only AI-originated signal is one `addressed` badge on an item the user wrote; nothing is proposed unprompted |
| V. Compression preserves meaning | Reductions traceable to source | PASS: no summaries are produced | PASS: `FEEDBACK.md` carries full text and full history, not summaries; the node's map label is only a hint beside the authoritative node id |
| VI. History is data | Changes kept, not overwritten | PASS: FR-016 | PASS: the state history is an append-only table. `rank` is overwritten, like Feature 2's hand-placed positions, because it is a display preference, not a transition (R3) |

No violations; Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/003-feedback-loop/
├── plan.md                 # This file
├── research.md             # Phase 0 output
├── data-model.md           # Phase 1 output
├── quickstart.md           # Phase 1 output
├── contracts/
│   ├── http-api.md         # Feedback endpoints and shapes
│   └── feedback-file.md    # FEEDBACK.md format and the two npm scripts
└── tasks.md                # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

New and changed files within the existing layout:

```text
src/
├── app/
│   ├── layout.tsx                               # CHANGED: Feedback button + drawer mounted once
│   └── api/feedback/
│       ├── route.ts                             # NEW GET list, POST create (multipart)
│       ├── [id]/position/route.ts               # NEW PUT
│       ├── [id]/resolve/route.ts                # NEW POST
│       ├── [id]/reopen/route.ts                 # NEW POST
│       └── attachments/[id]/route.ts            # NEW GET image / ?thumb=1
├── instrumentation.ts                           # NEW regenerate FEEDBACK.md on server start
├── components/feedback/                         # NEW FeedbackButton, FeedbackDrawer, FeedbackForm,
│                                                #     FeedbackList, FeedbackCard, TagFilter, Lightbox
├── lib/feedbackContext.ts                       # NEW pathname → { view, nodeId }
├── lib/thumbnail.ts                             # NEW canvas → WebP thumbnail
├── state/feedbackStore.ts                       # NEW drawer open, draft, items, filter
├── shared/schemas.ts                            # CHANGED FeedbackItem & friends
└── server/
    ├── db/migrations/0003_feedback.ts           # NEW tables, enums, checks, triggers
    ├── db/schema.ts                             # CHANGED table interfaces
    └── feedback/                                # NEW
        ├── paths.ts                             #   FEEDBACK_DIR resolution, repo-relative paths
        ├── rankKey.ts                           #   keyBetween(), createdAt → key
        ├── create.ts                            #   validate, write files, insert, regenerate
        ├── list.ts                              #   ordered items with tags, attachments, history
        ├── position.ts                          #   drag → one rank update
        ├── state.ts                             #   resolve, reopen, markAddressed (row lock)
        ├── attachments.ts                       #   magic-byte check, write with 'wx', read
        └── exportFile.ts                        #   render + atomic write under advisory lock

scripts/
├── feedback-addressed.ts                        # NEW npm run feedback:addressed -- <id>
├── feedback-export.ts                           # NEW npm run feedback:export
└── seed-large.ts                                # CHANGED --feedback N

CLAUDE.md                                        # CHANGED short "Feedback" section (outside AGENTS.md)
.gitignore                                       # CHANGED feedback/, .feedback-test/
package.json                                     # CHANGED two scripts
playwright.config.ts                             # CHANGED FEEDBACK_DIR for e2e

tests/unit/f3-rank-key.test.ts, f3-feedback-file.test.ts, f3-context.test.ts
tests/integration/f3-us1-capture.test.ts … f3-us5-attachments.test.ts, f3-append-only.test.ts
tests/e2e/f3-us1-capture.spec.ts … f3-us5-screenshots.spec.ts
```

**Structure Decision**: The same single Next.js project. Feedback domain logic lives in
`src/server/feedback/` with no Next.js imports, so the two scripts can call it directly, as
`scripts/migrate.ts` already does with `src/server/db`. The drawer is mounted once in the root
layout, next to `MapHost`.

## Open Points for the User

- **Git-ignore `feedback/`** (default: yes). Screenshots and personal notes stay out of the repo,
  and Claude Code can still read the files, because ignoring affects git, not the filesystem. The
  alternative is to commit `FEEDBACK.md` and the attachments to keep a history of the feedback in
  git.
- **Tags and screenshots only at submission in v1** (research R4). This resolves the gap the spec
  checklist flagged. Adding them later would be a small additive change.
- **The script writes to Postgres directly** (research R7). It works while the app is stopped, but
  needs the Docker database running.
- **Definitions is recorded as its own view** (research R2), beyond the spec's chat and map.

## Complexity Tracking

No constitution violations; nothing to justify.
