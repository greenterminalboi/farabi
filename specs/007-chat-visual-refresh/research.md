# Research: Chat Bubble and Input Visual Refresh

There were no NEEDS CLARIFICATION items in Technical Context. The open questions were design
choices the spec deliberately left to planning ("precise values are left to design and planning").

## R1. What exists today

- **Decision**: Build on the current styles; don't rewrite them.
- **Findings** (`src/app/globals.css`, `src/components/chat/*`):
  - `.chat` is already a centered column: `max-width: 820px; margin: 0 auto`.
  - The header, inherited context, message list and composer each add their own 16px side
    padding or margin.
  - `.message[data-role="user"]` is already a content-sized bubble: `width: fit-content`,
    `max-width: min(80%, 640px)`, 18px radius, `--accent-soft` fill and
    `overflow-wrap: anywhere`. It is left-aligned only because nothing pushes it right.
  - AI messages have no background, and the AI tag is rendered in `.role`.
  - The composer is a flex row: a bordered textarea with 8px radius and `max-height: 45vh`, and a
    labelled `.btn` for Send or Stop beside it.
- **Rationale**: The gap between today's UI and the spec is small. Changing only that gap keeps
  the risk to Features 1–5 near zero (FR-010).

## R2. Column width and margins

- **Decision**: Keep the 820px column. Replace the scattered 16px paddings with `--chat-column:
  820px` and `--chat-gutter: 16px` on `:root`, and use them in `.chat`, `.node-header`,
  `.inherited`, `.anchor-quote`, `.message-list`, `.composer` and `.composer-error`.
- **Rationale**: 820px minus two 16px gutters gives a line length of about 788px. With the
  OpenDyslexic font that is already a comfortable reading measure, and users are used to it.
  Tokens ensure the bubble's right edge and the AI text's left edge sit on the same column
  edges (FR-005, SC-002). Below 820px the column fills the window and keeps the 16px gutters.
- **Alternatives considered**:
  - A narrower column (~720px) to match other chat apps more closely. Rejected: it changes line
    length for every existing AI reply, which the spec says stays "exactly as it renders today"
    (FR-002).
  - Moving the scroll container to full window width with a centered inner column, so the
    scrollbar sits at the window edge. Rejected: `listRef`, scroll restore and selection
    positioning all assume `.message-list` is the column. It's a larger change for a cosmetic gain.

## R3. User bubble alignment and sizing

- **Decision**: Add `margin-left: auto` to `.message[data-role="user"]` and keep `width:
  fit-content`, `max-width: min(80%, 640px)` and `overflow-wrap: anywhere`. Any `.role` row inside
  a user message (e.g. a Regenerate button, if the server ever offers one on a user message) stays
  inside the bubble. Its layout doesn't change.
- **Rationale**: The bubble is a block element inside a block scroll container, so auto left
  margin right-aligns it without changing the element or its offsets. `overflow-wrap: anywhere`
  already covers the long-URL edge case. The existing padding plus `fit-content` keeps a
  one-emoji bubble at a sensible minimum size. A `min-width` of about 2.5em avoids a pill thinner
  than it is tall.
- **Alternatives considered**: A flex column on `.message-list` with `align-self: flex-end`.
  Rejected: it changes margin collapsing between messages and risks the scroll-restore behavior.

## R4. Composer container and send control

- **Decision**:
  - `.composer` (the form) becomes the rounded box: `--surface` fill, 1px `--border`, 24px radius
    and a soft shadow. It is inset by `--chat-gutter` and loses its `border-top` rule.
  - The textarea becomes borderless and transparent, and keeps `resize: none`, `min-height` and
    `max-height: 45vh`.
  - Focus is shown on the box with `:focus-within` (accent border), because the textarea's own
    outline is removed.
  - Placeholder color is set explicitly to `--muted` (FR-009).
  - Send and Stop become `.composer-icon-btn`: a 32px circle at the bottom-right, inside the box
    (`align-self: flex-end`).
    - **Send**: accent fill with an up-arrow SVG, `aria-label="Send"`, `title="Send"`. It keeps
      its exact `disabled` expression.
    - **Stop**: neutral fill with a filled-square SVG, `aria-label="Stop"`, `title="Stop"`.
- **Rationale**:
  - "Consistent with the rounding and shading of user bubbles" (FR-006) means the same soft,
    filled, rounded family. It does not mean an identical color: an input tinted exactly like a
    sent message would look like a message that has already been sent.
  - Stop gets the same icon treatment because it replaces Send in the same spot during
    streaming. A text button appearing where an icon was would break the single-box look.
  - The accessible names stay "Send" and "Stop", so `getByRole("button", { name: "Stop" })`
    in `helpers.ts` and the streaming specs keep working, and screen readers still name the
    buttons.
  - Inline SVG with `currentColor` follows both color schemes, needs no dependency, and matches
    the existing `TermCard` lock icon.
- **Alternatives considered**:
  - An icon library (e.g. lucide-react). Rejected: a new dependency for two glyphs.
  - Absolute-positioning the button over the textarea. Rejected: typed text would run underneath
    the button unless padded. A flex row inside the box handles growth naturally and keeps the
    button pinned to the bottom as the box grows.

## R5. Auto-grow and error line

- **Decision**: Don't change the `useLayoutEffect` sizing code. `max-height: 45vh` stays on the
  textarea, so the growth limit is identical (FR-008). The `.composer-error` line stays above the
  box and uses the gutter token.
- **Rationale**: The sizing reads `getComputedStyle(box).maxHeight` from the textarea, so as long
  as that rule stays on the textarea, behavior can't change.

## R6. Verification approach

- **Decision**: Add one Playwright spec (`f7-chat-visual.spec.ts`) that checks geometry with
  `boundingBox()` at 3 viewport widths (1440, 1024, 700), rather than using screenshots.
- **Rationale**: SC-001–SC-003 describe layout relations, such as right-aligned, content-sized,
  same column edges, and an icon inside the box. Those can be asserted directly and aren't
  brittle across fonts or color schemes the way pixel snapshots are. SC-004 is covered by
  keeping the existing suite green.
