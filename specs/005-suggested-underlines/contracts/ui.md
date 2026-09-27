# Contract: Chat UI

## Markup

Every segment span covered by a suggestion gets:

- `class` containing `suggest-mark`, next to `marker`, `depth-*` or `term-mark` if those also apply
- `data-suggest="<start>-<end>"`, the whole suggestion's raw offsets. They're the same on every
  segment of that suggestion.

Only complete AI messages receive suggestions. Streaming, incomplete, stopped and failed messages
and user messages never have `suggest-mark` (FR-003, FR-007).

## Look (`globals.css`)

| Meaning | CSS property | Look |
|---------|--------------|------|
| Branch marker (F1) | `background-color`, `border-bottom` | Amber fill and solid 2 px line |
| Definition term (F2) | `text-decoration` | Purple dotted underline, 1.5 px |
| Suggestion (F5) | `background-image` | Grey (`--muted`) dotted line, about 1 px, below the term underline |

Each meaning uses its own property, so all three can show on the same text (FR-010, SC-003). A
suggestion adds `cursor: pointer`, but only where no marker or term already sets a cursor.

## Click order (`ChatView.onListClick`)

1. Inside `[data-markers]`: open the branch, as in Feature 1.
2. Inside `.term-mark`: do nothing. The term keeps its hover card and lock (Feature 2).
3. Inside `[data-suggest]` with a collapsed selection:
   `rangeForOffsets(messageEl, start, end)`, then `removeAllRanges()`, then `addRange()`.
   `BranchAction` then shows Define and Branch through its existing `selectionchange` handler.
4. A non-collapsed selection (the user dragged): do nothing (FR-011).

## Toggle

The chat header has a button labelled "Suggestions" with `aria-pressed` set to the
`showSuggestions` value (FR-012). Turning it off removes every `suggest-mark` right away and stops
all suggestions requests.

## Test hooks

- `data-testid="suggestions-toggle"` on the toggle button.
- The `suggest-mark` class and `data-suggest` attribute are enough for Playwright.
