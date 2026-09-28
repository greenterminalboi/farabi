# UI Contract: Chat Messages and Composer

What the restyled chat guarantees to users, tests, and the code that reads the chat's DOM
(selection, branching, suggestions, definitions).

## Unchanged DOM (must not change)

- `section.chat[data-node-id]` > `NodeHeader`, `InheritedContext`, `div.message-list[data-testid="message-list"]`, `Composer`.
- `article.message[data-role="user"|"ai"][data-testid="message"]`, with `data-message-id` only
  when the message is complete.
- Everything inside `.body`: offset spans (`data-start`/`data-end`), `.marker`, term marks and
  suggestion spans. Feature 1, 2 and 5 contracts apply unchanged (FR-011).
- `.role` > `.ai-tag` ("AI") on AI messages (FR-003).
- `textarea[aria-label="Message"]` with placeholder "Write a message…" and the same key handling
  (Enter sends, Shift+Enter adds a line, "????" quick branch).
- `.composer-error[role="alert"]` above the composer.

## Layout guarantees

| ID | Guarantee | Req |
|----|-----------|-----|
| L1 | `.chat` is at most `--chat-column` (820px) wide and centered. Below that width it fills the window. All chat rows (header, inherited context, list content, composer) share `--chat-gutter` (16px) side insets. | FR-004, SC-002 |
| L2 | A user message's right edge is at the list's content right edge (within 1px). Its width fits its text, up to `min(80%, 640px)` of the list. Long unbroken tokens wrap inside it. | FR-001, FR-005 |
| L3 | A user message has a non-transparent background and a border radius of at least 12px. | FR-001 |
| L4 | An AI message's left edge is at the list's content left edge. Its background is transparent and it has no visible border (a failed message's danger border is unchanged). | FR-002 |
| L5 | Neither kind of message extends past the list's content box. | FR-005 |

## Composer guarantees

| ID | Guarantee | Req |
|----|-----------|-----|
| C1 | `form.composer` is the only visible input container: rounded (radius ≥ 16px), filled and bordered. The textarea inside it has no border or background of its own. | FR-006 |
| C2 | Not streaming: a single `button[type=submit][aria-label="Send"]` with no visible text, containing an SVG icon. Its box is fully inside the `form.composer` box. It is disabled exactly when it is today (sending, busy, or the draft is blank). | FR-007 |
| C3 | Streaming: the Send button is replaced in the same spot by `button[type=button][aria-label="Stop"]`, icon-only, with the same behavior (calls `onStop`). | FR-007 |
| C4 | The textarea keeps `max-height: 45vh` and the existing sizing effect. It grows with content, then scrolls (`.overflowing`). | FR-008 |
| C5 | The placeholder is drawn in `--muted` and disappears when there is any text. | FR-009 |
| C6 | Keyboard focus on the textarea is visible on the box (`:focus-within`). | accessibility |
