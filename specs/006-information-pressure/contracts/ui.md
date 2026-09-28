# Contract: UI

## Top bar

- A new `SettingsLink` (⚙, `aria-label="Settings"`, `href="/settings"`) sits between the new
  conversation button and Feedback, in `src/app/layout.tsx`.

## `/settings` page (`src/app/settings/page.tsx`, client component `SettingsForm`)

### Reply detail

- A slider: `<input type="range" min="1" max="10" step="1" aria-label="Information pressure">`.
  - Its `aria-valuetext` is `"8 · Detailed"`.
  - `data-testid="pressure-slider"`.
- A band row: five labels, each spanning two stops. The current band gets `aria-current="true"`.
- A readout: `"Level 8 · Detailed"`, `data-testid="pressure-readout"`.

### Reply model

- `<select aria-label="Reply model" data-testid="model-select">`, with the options from `models`
  in order. "Default" shows the hint "the model Farabi is configured with".

### Saving

- A slider change is saved on `change` (when the thumb is released or a key is pressed), not on
  every `input` event while dragging.
- The select is saved on `change`.
- While saving, the control is disabled. On success it shows "Saved" (`role="status"`) for 2 s.
- On failure it goes back to the stored value and shows "Couldn't save. Your previous setting is
  still in effect" (`role="alert"`).

### Scope note

- The page states that the settings apply to new chat replies in every conversation, and don't
  affect summaries, definitions or suggestions.

## Label on each reply (`Message.tsx`)

- Only for AI messages with `pressureLevel !== null`, next to the AI tag:
  `<span class="reply-meta" data-testid="reply-meta" title="Settings when this reply was written">Detailed · 8 · Claude Opus 5</span>`.
- When `replyModel` is null the model part reads "Default model". Unknown IDs are shown as they
  are.
- Style: `font-size: 0.75em; color: var(--muted)`, the same as the existing `.role` row.
