---

description: "Task list for Feature 007: Chat Bubble and Input Visual Refresh"
---

# Tasks: Chat Bubble and Input Visual Refresh

**Input**: Design documents from `specs/007-chat-visual-refresh/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[contracts/ui.md](./contracts/ui.md), [quickstart.md](./quickstart.md). There is no data model
change ([data-model.md](./data-model.md)).

**Tests**: Included. The plan specifies one Playwright spec, `tests/e2e/f7-chat-visual.spec.ts`,
that checks geometry at 1440, 1024 and 700px wide (research R6). It also requires the existing
e2e suite to stay green (SC-004).

**Scope guard (applies to every task)**: Don't change anything inside `.body` (offset spans,
`.marker`, term marks, suggestion spans), `Message.tsx`, `ChatView.tsx`, `InheritedContext.tsx`,
any server, state or schema file, or the `useLayoutEffect` sizing code in `Composer.tsx`
(FR-008, FR-010, FR-011). Keep the accessible names "Message", "Send" and "Stop".

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 = Messages read as a conversation, US2 = Centered reading column,
  US3 = Composer that matches the surface

---

## Phase 1: Setup

- [X] T001 Install dependencies in the worktree (`npm install` in `/Users/halda/Projects/farabi-007-chat-visual-refresh`). Confirm the baseline with `npm run typecheck` and `npm run lint`, and record any failures that already exist so they aren't blamed on this feature.
- [X] T002 Create `tests/e2e/f7-chat-visual.spec.ts` with the imports and setup used by the other e2e specs: `import { expect, test } from "@playwright/test"`, helpers `resetDb`, `send`, `setAiMode` and `startConversation` from `./helpers`, and `test.beforeEach(resetDb)`. Add a top comment: `// Feature 007: chat bubble and composer visual refresh (contracts/ui.md).` Add a local `WIDTHS = [1440, 1024, 700]` constant.

---

## Phase 2: Foundational (blocks all stories)

- [X] T003 In `src/app/globals.css`, add `--chat-column: 820px;` and `--chat-gutter: 16px;` to the `:root` block (line 1). They are layout values, not colors, so the dark-mode `:root` block doesn't redefine them. Change the `.chat` rule to use `max-width: var(--chat-column);` instead of the literal `820px`. Nothing else changes yet.

**Checkpoint**: the app looks identical, since the tokens equal the old literals.

---

## Phase 3: User Story 1 — Messages read as a conversation (Priority: P1) 🎯 MVP

**Goal**: User messages are right-aligned, content-sized, rounded and shaded bubbles. AI replies
stay unbubbled, left-aligned and tagged "AI".

**Independent test**: Send "Hi" and a long multi-line message. Both user bubbles hug the right
edge and fit their text. The long one is capped and wraps. AI replies are transparent, start at
the left edge and show `.ai-tag`.

### Tests for User Story 1

- [X] T004 [US1] In `tests/e2e/f7-chat-visual.spec.ts`, add a test `"user messages are right-aligned content-sized bubbles; AI replies stay plain and tagged"`. It checks contract L2–L5 for each width in `WIDTHS`, using `page.setViewportSize({ width, height: 900 })`:
  - `startConversation(page)`, then `send(page, "Hi")`.
  - Read the list's content box: `const list = page.getByTestId("message-list")`. Compute `contentLeft`/`contentRight` from `list.evaluate(el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { left: r.left + parseFloat(cs.paddingLeft), right: r.right - parseFloat(cs.paddingRight) - (el.offsetWidth - el.clientWidth) }; })`. This excludes the scrollbar width.
  - For the last `[data-role="user"]`, assert `Math.abs(box.x + box.width - contentRight) <= 1` (right-aligned, L2), `box.width < (contentRight - contentLeft) / 3` (content-sized, L2), `backgroundColor !== "rgba(0, 0, 0, 0)"` and `parseFloat(borderTopLeftRadius) >= 12` (L3).
  - For the last `[data-role="ai"]`, assert `Math.abs(box.x - contentLeft) <= 1` (L4), background `"rgba(0, 0, 0, 0)"`, and that `.ai-tag` is visible with text "AI" (FR-003).
  - Assert that neither box extends past `[contentLeft, contentRight]` (L5).
- [X] T005 [US1] In the same file, add a test `"a long user message wraps inside a capped bubble"`:
  - Send a message made of 40 repeated words plus one 200-character unbroken token, e.g. `"x".repeat(200)`.
  - Assert the last user bubble's right edge equals `contentRight` (±1px).
  - Assert its width is at most `Math.min(0.8 * (contentRight - contentLeft), 640) + 1`, and that its height is more than 2× the height of the "Hi" bubble from a prior `send`.
  - Assert `el.scrollWidth <= el.clientWidth`, so the token doesn't overflow.
  - Also send `"👍"` and assert that bubble's width is at least its height minus 1px, so it isn't a sliver (edge case: single emoji).

### Implementation for User Story 1

- [X] T006 [US1] In `src/app/globals.css`, change the `.message[data-role="user"]` rule (~line 81):
  - Add `margin-left: auto;` so the bubble right-aligns (research R3).
  - Add `min-width: 2.5em; text-align: left;`. The min-width keeps a single emoji from becoming a thin sliver; the text-align keeps multi-line text left-aligned inside the bubble.
  - Keep `width: fit-content; max-width: min(80%, 640px); padding: 10px 16px; border-radius: 18px; background: var(--accent-soft); overflow-wrap: anywhere;` exactly as they are.
  - Replace the comment above `.message` ("Claude-style: your messages are bubbles that start at the left…") with: `/* Your messages are bubbles on the right that fit their text; AI replies sit on the page without a bubble (Feature 007). */`.
- [X] T007 [US1] Update the older bubble test in `tests/e2e/feedback-round-1.spec.ts` (`"your messages are bubbles that fit their text; AI replies have no bubble"`) only if it now fails. Its assertions (width < list/3, AI transparent, AI tag visible) should still pass unchanged; confirm by running `npx playwright test tests/e2e/feedback-round-1.spec.ts`. Only update the test's name if it mentions the left side, since the name doesn't describe alignment.
- [X] T008 [US1] Run `npx playwright test tests/e2e/f7-chat-visual.spec.ts -g "bubble"`. T004 and T005 must pass at all three widths.

**Checkpoint**: US1 is shippable on its own; the composer and gutters are unchanged.

---

## Phase 4: User Story 3 — A composer that matches the rest of the surface (Priority: P1)

**Goal**: One rounded input box, with an icon-only Send (or Stop) button inside it. Auto-grow and
sending behave exactly as before.

**Independent test**: The empty composer shows a muted placeholder inside one rounded box. An
icon-only "Send" button sits inside the box and is disabled while empty. Typing lines grows the
box, clicking the icon sends, and Stop appears in the same spot while streaming.

### Tests for User Story 3

- [X] T009 [US3] In `tests/e2e/f7-chat-visual.spec.ts`, add a test `"composer is one rounded box with an icon-only Send inside it"`:
  - `startConversation(page)`, then `const form = page.locator("form.composer")` and `const sendBtn = page.getByRole("button", { name: "Send" })`.
  - Assert `sendBtn` has an empty `innerText` after trimming and contains an `svg` (C2).
  - Assert the send button's bounding box lies within the form's bounding box on all four sides (C2).
  - Assert the form's computed `borderTopLeftRadius` is at least 16 and its `backgroundColor` isn't transparent (C1).
  - Assert the textarea's `borderTopWidth` is `"0px"` and its `backgroundColor` is `"rgba(0, 0, 0, 0)"` (C1).
  - Assert `sendBtn` is disabled when the draft is empty and enabled after `fill("hello")` (C2).
  - Assert the placeholder is `"Write a message…"`. Check that its color differs from the typed text color: read `getComputedStyle(textarea, "::placeholder").color` and compare it to `getComputedStyle(textarea).color` (C5).
  - Click `sendBtn`, then assert the message count increases by 2 and use `waitForReplyEnd` from helpers to let the reply finish (acceptance 3.5).
- [X] T010 [US3] In the same file, add a test `"Stop replaces Send in place while a reply streams"`:
  - `setAiMode(page, "ok", 0, 400)`, fill the textarea, press Enter.
  - Assert that `getByRole("button", { name: "Stop" })` is visible, has empty text, contains an `svg` and sits inside `form.composer` (C3).
  - Click it, expect `getByTestId("ended-early")` to contain "Stopped", then restore with `setAiMode(page, "ok")`.
- [X] T011 [US3] In the same file, add a test `"composer still grows, then scrolls, at about half the screen"`, using the same approach as `feedback-round-1.spec.ts`:
  - Type 4 lines with Shift+Enter and expect the height to grow by more than 40px.
  - Then type 60 lines and expect the textarea height to be at most `0.45 * 900 + 2` (viewport height 900) and the textarea to have class `overflowing` (C4, FR-008).

### Implementation for User Story 3

- [X] T012 [US3] In `src/components/chat/Composer.tsx`, replace the two text buttons (the `streaming ? … : …` block):
  - **Stop**: `<button type="button" className="composer-icon-btn composer-stop" onClick={onStop} aria-label="Stop" title="Stop">` containing `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor" /></svg>`.
  - **Send**: `<button type="submit" className="composer-icon-btn composer-send" disabled={sending || disabled || !draft.trim()} aria-label="Send" title="Send">` containing `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>`.
  - Keep the `disabled` expression byte-identical, and don't change the `useLayoutEffect`, `submit`, `onChange` or `onKeyDown` code.
- [X] T013 [US3] In `src/app/globals.css`, rewrite the composer rules (~lines 127–135) per research R4 and contract C1–C6:
  - `.composer { display: flex; align-items: flex-end; gap: 8px; margin: 8px var(--chat-gutter) 16px; padding: 6px 6px 6px 16px; border: 1px solid var(--border); border-radius: 24px; background: var(--surface); box-shadow: 0 1px 6px rgba(0, 0, 0, 0.06); }`. Remove the old `border-top` and the second `.composer { align-items }` rule.
  - `.composer:focus-within { border-color: var(--accent); }`
  - `.composer textarea { flex: 1; font: inherit; padding: 8px 0; border: 0; background: transparent; color: var(--text); resize: none; min-height: 36px; max-height: 45vh; overflow-y: hidden; outline: none; }`. Keep `max-height: 45vh` because the sizing effect reads it.
  - `.composer textarea::placeholder { color: var(--muted); opacity: 1; }`
  - Keep `.composer textarea.overflowing { overflow-y: auto; }`.
  - `.composer-icon-btn { flex: none; width: 32px; height: 32px; border-radius: 50%; border: 0; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }`
  - `.composer-send { background: var(--accent); color: #fff; }`
  - `.composer-send:disabled { background: var(--border); color: var(--muted); cursor: default; }`
  - `.composer-stop { background: var(--text); color: var(--bg); }`
  - `.composer-icon-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`
  - Change `.composer-error` padding to `0 var(--chat-gutter) 8px`.
- [X] T014 [US3] Check that the Feature 003 feedback composer isn't affected. `.feedback-form` has its own rules at ~line 228 and must not match `.composer`. Confirm with `grep -n "composer" src/components/feedback/*.tsx`, which should find nothing. If it does, stop and adjust the selectors, not the feedback component.
- [X] T015 [US3] Run `npx playwright test tests/e2e/f7-chat-visual.spec.ts -g "composer|Stop"` and `npx playwright test tests/e2e/feedback-round-1.spec.ts tests/e2e/f2-us1-streaming.spec.ts tests/e2e/regenerate-offline.spec.ts`. All must pass. The last spec checks the `.composer-error` text.

**Checkpoint**: US1 and US3 are done, which covers both P1 stories.

---

## Phase 5: User Story 2 — A consistent, centered reading column (Priority: P2)

**Goal**: Every chat row shares the same centered column and side gutters, so bubbles, AI text,
header, inherited context and composer line up at every width.

**Independent test**: At 1440, 1024 and 700px wide, the list's content edges, the composer box
edges and the header's content edges coincide (±1px). At 1440 and 1024, the column is centered
with equal space on both sides.

### Tests for User Story 2

- [X] T016 [US2] In `tests/e2e/f7-chat-visual.spec.ts`, add a test `"chat rows share one centered column at every width"`. For each width in `WIDTHS`:
  - `setViewportSize`, `startConversation`, `send(page, "Hi")`.
  - Get the `section.chat` box. Where the viewport is wider than 820 + the map/sidebar width (use the `.main` box instead of the viewport), assert `Math.abs((chat.x - main.x) - (main.x + main.width - chat.x - chat.width)) <= 1` (centered, L1) and `chat.width <= 820`.
  - Assert that the `form.composer` box's left and right edges equal `contentLeft`/`contentRight` of the message list (±1px, ignoring the scrollbar as in T004).
  - Assert that the `.node-header` content left, i.e. box x plus `paddingLeft`, equals `contentLeft` (±1px).
  - For a branch, use `branchOn` from helpers on a phrase in the AI reply. Then assert `[data-testid="anchor-quote"]` lies within `[contentLeft, contentRight]` (edge case: inherited context fits the column).

### Implementation for User Story 2

- [X] T017 [US2] In `src/app/globals.css`, replace the literal `16px` side spacing on chat rows with `var(--chat-gutter)`:
  - `.node-header` padding → `12px var(--chat-gutter) 4px`
  - `.message-list` padding → `8px var(--chat-gutter) 16px`
  - `.inherited` margin → `8px var(--chat-gutter) 0`
  - `.anchor-quote` margin → `8px var(--chat-gutter) 0`
  - `.composer` and `.composer-error` already use the token (T013).

  Don't change any other values. If `.message-list`'s visible scrollbar makes the right content edge differ from the composer's right edge by more than 1px on macOS overlay-less scrollbars, add `scrollbar-gutter: stable both-edges;` to `.message-list`. The column then stays symmetric whether or not the list scrolls. Record the choice in a one-line CSS comment.
- [X] T018 [US2] Run `npx playwright test tests/e2e/f7-chat-visual.spec.ts`. The whole file must pass, all 6 tests at all widths.

**Checkpoint**: all three stories are complete.

---

## Phase 6: Polish & Cross-Cutting

- [X] T019 Run `npm run typecheck`, `npm run lint` and `npm test`. Everything must be clean relative to the T001 baseline.
- [X] T020 Run the full e2e suite with `npm run test:e2e` (SC-004: no regression in Features 1–5). Pay attention to `f2-us4-definitions.spec.ts`, `f5-suggestions.spec.ts`, `us2-branch.spec.ts` and `f2-us2-quick-branch.spec.ts`, which exercise selection and underlines inside the moved bubbles. Fix only CSS or Composer causes. Don't change those specs' assertions.
- [X] T021 Walk through the manual steps in `specs/007-chat-visual-refresh/quickstart.md` with `npm run dev`, in light and dark mode:
  - Bubbles on the right, AI text on the left with the AI tag.
  - The column at 3 widths.
  - The composer box: placeholder, growth, icon send and stop.
  - Branch context.
  - Definition and suggestion underlines still clickable.

  Record anything off as a follow-up. Don't widen scope.
- [X] T022 Confirm the diff only touches `src/app/globals.css`, `src/components/chat/Composer.tsx`, `tests/e2e/f7-chat-visual.spec.ts`, optionally the `feedback-round-1.spec.ts` test name (T007), and `specs/007-chat-visual-refresh/`. Run `git diff --stat main...HEAD` plus `git status`. Revert anything else.

---

## Dependencies & Execution Order

- **Setup (T001–T002)** → **Foundational (T003)** → stories.
- **US1 (T004–T008)** and **US3 (T009–T015)** are independent of each other after T003. Their
  test tasks both edit `f7-chat-visual.spec.ts` and their implementation tasks both edit
  `globals.css`, so run them one after the other (no [P] markers). The recommended order is US1,
  then US3.
- **US2 (T016–T018)** comes after US3, because its composer-edge assertion relies on the T013
  composer margins. It can also start after US1 alone if the composer assertion is deferred.
- **Polish (T019–T022)** comes after all stories.

## Parallel Examples

The feature is small, and almost every task edits one of two shared files
(`src/app/globals.css`, `tests/e2e/f7-chat-visual.spec.ts`), so there is little safe parallelism:

- T012 (`Composer.tsx`) can run alongside T013 (`globals.css`) if they're split across two
  people. T012 is marked sequential here only because T013 styles the classes it introduces.
- T014 (a read-only grep) can run at any time after T001.
- In Polish, T019 and T021 can overlap: one runs checks while the other does the manual review.

## Implementation Strategy

1. **MVP = US1** (T001–T008): one CSS rule change right-aligns the bubbles. This alone meets the
   feature's main goal (SC-001).
2. **Then US3** (T009–T015): the composer box and icon buttons, which completes both P1 stories
   (SC-003).
3. **Then US2** (T016–T018): shared gutters and a verified column at 3 widths (SC-002).
4. **Polish** (T019–T022): the full regression run (SC-004) and the manual review.

Each checkpoint leaves the app shippable. Commit after each phase on `007-chat-visual-refresh`.
