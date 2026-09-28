# Implementation Plan: Chat Bubble and Input Visual Refresh

**Branch**: `007-chat-visual-refresh` | **Date**: 2026-09-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/007-chat-visual-refresh/spec.md`

## Summary

Most of the target look already exists. User messages are already content-sized, rounded bubbles
(`.message[data-role="user"]`, from the Feature 003 feedback round), just anchored to the left.
AI replies already have no bubble and keep the AI tag. The chat is already a centered column
(`.chat`, max 820px, 16px side gutters).

What changes:

1. **Bubbles move right.** User bubbles get `margin-left: auto` so they sit at the right edge of the
   same column the AI text uses. The width cap stays `min(80%, 640px)`.
2. **One column token.** The column width and gutter become CSS custom properties (`--chat-column`,
   `--chat-gutter`) shared by the header, inherited context, message list and composer. Every row
   then has exactly the same edges (FR-004, FR-005).
3. **Composer becomes one rounded box.** The `<form class="composer">` becomes the visible
   rounded container. The textarea inside it loses its own border and background. Send and Stop
   become icon-only round buttons at the box's bottom-right, with `aria-label`s "Send" and "Stop"
   and an inline SVG icon. Auto-grow logic in `Composer.tsx` is untouched (FR-008).

No data, API, server, state or text-rendering change. Everything is in `globals.css` and
`Composer.tsx`, plus one new end-to-end spec.

## Technical Context

**Language/Version**: TypeScript 6, React 19, Next 16 App Router (unchanged)

**Primary Dependencies**: None new. Icons are inline SVG, the same way `TermCard.tsx` draws its
lock icon (research R4).

**Storage**: N/A (no storage change)

**Testing**: Playwright end-to-end with the fake provider: a new `tests/e2e/f7-chat-visual.spec.ts`.
It must also keep the existing specs green that cover the areas touched here:
`feedback-round-1.spec.ts` (bubble size, auto-grow), `f2-us1-streaming.spec.ts` and `helpers.ts`
(Stop found by its accessible name), `f2-us4-definitions.spec.ts`, and `f5-suggestions.spec.ts`
(underlines inside messages). There is no logic to unit-test.

**Target Platform**: local web app (127.0.0.1), desktop browsers, light and dark color schemes.

**Project Type**: web application, a single Next.js project (`src/components`, `src/app`).

**Performance Goals**: no measurable change. The change is CSS layout plus one static SVG per
button, and adds no re-renders.

**Constraints**: Must not touch the offset-bearing DOM inside `.body`: `data-start`/`data-end`
spans, markers, term marks, suggestion spans. Selection and branch code depend on it (FR-011).
The composer's accessible names "Message", "Send" and "Stop" stay the same because tests and
screen readers use them.

**Scale/Scope**: 2 source files changed (`src/app/globals.css`, `src/components/chat/Composer.tsx`),
1 e2e spec added.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Article | Check | Result |
|---------|-------|--------|
| I. User is final authority | Authorship stays visually unambiguous: user text is bubbled on the right, AI text is unbubbled on the left with the AI tag kept (FR-002, FR-003). No provenance state is added, removed or merged. | Pass |
| II. Additive growth | No change to nodes, branches, markers or deletion. | Pass |
| III. Nothing invented ahead of evidence | No AI output or suggestion logic touched. | Pass |
| IV. User-led exploration first | The composer, the user's own entry point, stays in view and gets clearer. Nothing AI-initiated is added. | Pass |
| V. Compression preserves meaning | No summaries or labels touched. | Pass |
| VI. History is data | No history or personalization touched. | Pass |

No violations. **Post-design re-check**: unchanged. The design only touches CSS and the button
markup inside `Composer.tsx`; see [contracts/ui.md](./contracts/ui.md).

## Project Structure

### Documentation (this feature)

```text
specs/007-chat-visual-refresh/
├── plan.md              # This file
├── research.md          # Phase 0: design decisions
├── data-model.md        # Phase 1: records that there is no data change
├── quickstart.md        # Phase 1: how to verify
├── contracts/
│   └── ui.md            # Phase 1: DOM/visual contract for messages and composer
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
src/
├── app/
│   └── globals.css              # column tokens, right-aligned bubble, composer box + icon button
└── components/
    └── chat/
        └── Composer.tsx         # Send/Stop become icon-only buttons with aria-labels

tests/
└── e2e/
    └── f7-chat-visual.spec.ts   # new: alignment, column edges at 3 widths, composer chrome
```

**Structure Decision**: This is the existing single Next.js project. The only files touched are
the chat's stylesheet section and its composer component. `Message.tsx`, `ChatView.tsx` and
`InheritedContext.tsx` keep their markup, because the current `data-role` attributes and class
names are enough to style against.

## Complexity Tracking

No constitution violations to justify.

## Parallel-work note

Feature 006 (Information Pressure) is in progress on `main`'s working tree. It adds a Settings
control and changes reply length, not the chat markup. Expected overlap is at most nearby lines in
`globals.css`, which can be resolved at merge.
