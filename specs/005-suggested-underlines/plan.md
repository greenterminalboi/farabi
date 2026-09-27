# Implementation Plan: Suggested Branch Underlines

**Branch**: `005-suggested-underlines` | **Date**: 2026-09-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-suggested-underlines/spec.md`

## Summary

After an AI reply completes, the chat asks the server for suggestions. A low-effort AI call reads
only that reply's text and returns up to 3 phrases copied from it. The server finds each one in
the stored text, validates it, caches the resulting ranges in a hidden `span_suggestions` table
and returns them. The chat draws them as a grey dotted underline, adding a third range kind to the
existing marker and term segmentation.

Clicking a suggestion builds a real DOM selection over the same offsets. The existing
`BranchAction` toolbar (Define, Branch) then takes over unchanged. Suggestions can be turned off
per browser; when they're off, no AI calls are made. No node, marker, definition or history entry
is ever created by a suggestion.

## Technical Context

**Language/Version**: TypeScript 6, Node (unchanged)

**Primary Dependencies**: Next 16 (App Router), React 19, react-markdown and rehype, zustand 5,
Kysely and pg, @anthropic-ai/sdk. No new dependencies.

**Storage**: PostgreSQL. Migration `0005_span_suggestions.ts` adds the `span_suggestions` cache
table ([data-model.md](./data-model.md)).

**Testing**: Vitest unit and integration tests, plus Playwright end-to-end (fake provider):
`tests/unit/f5-locate.test.ts` plus extended `markerRanges`/`selection` unit tests, `tests/integration/f5-suggestions.test.ts` and
`tests/e2e/f5-suggestions.spec.ts`.

**Target Platform**: local web app (127.0.0.1), desktop browsers.

**Project Type**: web application, a single Next.js project with `src/server` and
`src/components`.

**Performance Goals**: suggestions appear within 3 s of a reply completing with the API setup
(SC-005). The CLI setup is best-effort (research R4). Rendering suggestions adds no visible delay
to opening a conversation.

**Constraints**:

- Completed AI replies only.
- At most 3 suggestions per message.
- Nothing written outside `span_suggestions`.
- No AI calls while suggestions are off.
- No DELETE or PATCH routes.

**Scale/Scope**: conversations of up to a few hundred messages (the Feature 1 seed). Analysis runs
at most 2 jobs at once, newest messages first.

## Constitution Check

*Gate: checked before Phase 0 and re-checked after Phase 1.*

| Article | Result |
|---------|--------|
| I. User is final authority | PASS. Suggestions are always `ai_suggested`: the cache column has a CHECK, and they're drawn in the quietest style. They're never promoted to confirmed. A click only makes a selection, and the branch or definition the user then creates is recorded as Features 1 and 2 already record it. Suggestions never count toward depth or saturation, and nothing is derived from them. |
| II. Additive growth | PASS. No merge semantics. No DELETE or PATCH routes. Cache rows are insert-only (`ON CONFLICT DO NOTHING`), and messages are never altered (FR-009). |
| III. Nothing invented ahead of evidence | PASS. The detector's only input is the reply's own text, and every suggestion must be an exact substring of it (research R1, R2). Paraphrases are dropped. |
| IV. User-led exploration | PASS. There's a cap of 3, and the prompt prefers `NONE`, so suggestions stay sparse. They never block manual selection (FR-011). An on/off toggle lets them stay quiet (FR-012). Nothing is shown before the user has read a completed reply. |
| V. Compression preserves meaning | N/A. Nothing is summarized, and the underline covers the text itself. |
| VI. History is data | PASS. The toggle is a display switch, not a personalization of AI behavior derived from a stated preference (research R8). No learning history is changed or hidden. |

**Post-design re-check**: PASS. The design adds one insert-only table with no links into the
user's structure, one provider method whose input is only the reply's own text, and client-side
rendering. No violations, so Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/005-suggested-underlines/
├── plan.md              # This file
├── research.md          # Phase 0: R1–R8
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── ai-provider.md   # suggestSpans
│   ├── http-api.md      # POST /api/nodes/{nodeId}/suggestions
│   └── ui.md            # markup, styles, click order, toggle
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
src/server/db/migrations/0005_span_suggestions.ts   NEW cache table
src/server/db/schema.ts                             SpanSuggestionsTable
src/server/ai/provider.ts                           SuggestSpansInput, AIProvider.suggestSpans
src/server/ai/claudePrompts.ts                      SUGGEST_SYSTEM, buildSuggestRequest, parseSpans
src/server/ai/claude.ts, claudeCode.ts, fake.ts     suggestSpans implementations
src/server/suggestions/locate.ts                    NEW locateSpans (pure, research R2)
src/server/suggestions/queue.ts                     NEW in-process queue, cooldown, waitFor
src/server/suggestions/forNode.ts                   NEW read cache, enqueue missing, wait ≤ 5 s
src/app/api/nodes/[nodeId]/suggestions/route.ts     NEW POST handler
src/shared/schemas.ts                               SuggestedSpan, SuggestionsResponse
src/lib/api.ts                                      api.getSuggestions
src/state/settingsStore.ts                          NEW showSuggestions (persisted)
src/components/chat/markerRanges.ts                 suggestion ranges → suggest-mark, data-suggest
src/components/chat/rehypeSourceOffsets.ts          pass suggestions through
src/components/chat/Message.tsx                     suggestions prop (complete AI only)
src/components/chat/selection.ts                    rangeForOffsets
src/components/chat/ChatView.tsx                    fetch loop, click order, pass suggestions
src/components/chat/NodeHeader.tsx                  Suggestions toggle
src/app/globals.css                                 .suggest-mark
tests/unit/f5-locate.test.ts                        NEW
tests/unit/markerRanges.test.ts, selection.test.ts  extended: suggestion segments, rangeForOffsets round trip
tests/integration/f5-suggestions.test.ts            NEW endpoint, cache, SC-004 row counts
tests/integration/constitution.test.ts              extended guards
tests/e2e/f5-suggestions.spec.ts                    NEW quickstart scenarios 1–6
```

**Structure Decision**: this follows the existing single-project layout. Server logic goes in a
new `src/server/suggestions/` module, like `summaries/` and `definitions/`. UI changes stay in
`src/components/chat/`.

## Complexity Tracking

None. There are no constitution violations to justify.
