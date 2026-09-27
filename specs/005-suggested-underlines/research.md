# Research: Suggested Branch Underlines

Decisions made during planning. Each one resolves something the spec left to planning.

## R1. Detection method: one low-effort AI call per completed reply

- **Decision**: Add a new provider method, `suggestSpans`, whose only input is the reply's own text
  (FR-001, Article III). The model returns up to 3 phrases, copied exactly from the reply, that
  each open a separate thread worth exploring. The server then finds them in the stored text.
  - The call runs with low effort, like `summarize` and `define`.
  - The output format is plain text, one `SPAN: <exact text>` line per phrase, or the single line
    `NONE`. All three providers share one parser. Structured output isn't used because the Claude
    Code CLI setup can't enforce it.
- **Rationale**: The spec says "independently explorable" is a judgment call rather than a
  syntactic rule, so a fixed rule set would be too weak for it. Sending only the reply keeps the
  input small, and it means no suggestion can come from anywhere except that reply.
- **Alternatives considered**:
  - Rules based on lists, bold text or headings: rejected by the spec (Out of scope).
  - Asking the reply model to tag spans inline while it streams: this would change the reply text
    (FR-009), and reply streaming would depend on this feature.
  - Sending the whole conversation: more input tokens, and suggestions could drift toward topics
    from other messages.

## R2. Turning phrases into ranges: exact match plus validation on the server

- **Decision**: For each returned phrase, `locateSpans(content, phrases)`:
  1. Trims the phrase and finds its first exact occurrence in `content`. If there's none, it drops
     the phrase.
  2. Drops phrases with fewer than 2 words, more than 20 words, or more than 200 characters.
  3. Drops phrases that contain a line break or a markdown syntax character (`` ` * [ ] < > | # ``).
     This keeps each span to plain prose, so its rendered text matches the stored text and it can
     be selected (research R6 of Feature 1).
  4. Sorts by start offset and drops any phrase that overlaps one already kept, so overlaps never
     reach the screen (Edge Cases).
  5. Keeps at most 3 (FR-008).
- **Rationale**: A pure function that's easy to unit test. Models sometimes paraphrase, and exact
  matching rejects those phrases quietly instead of underlining text the reply never contained.

## R3. Hidden cache: `span_suggestions` table, keyed by message and detector version

- **Decision**: Keep one row per (message, detector version) with the validated ranges as `jsonb`
  (FR-013). Empty results are cached too, so a reply with no candidates isn't analyzed again.
  Failed calls are not cached (R5).
- **Rationale**: A completed message's text never changes, so the cache never goes stale. Adding
  the detector version to the key means a prompt change recomputes old messages instead of mixing
  results from two detectors.
- **Not part of the user's structure**: nothing joins this table into the node view, forest, map,
  definitions or summaries. Only the suggestions endpoint reads it (FR-006, FR-013). Rows carry
  `provenance = 'ai_suggested'`, enforced by a CHECK, so the existing Article I convention holds
  with no exception.

## R4. When to compute: lazily, only when a chat view asks

- **Decision**: Nothing is computed when a reply finishes. The chat view calls
  `POST /api/nodes/{nodeId}/suggestions` when suggestions are turned on. The server returns what's
  cached, queues analysis of the node's complete, live AI messages that have no cache row, and
  waits up to 5 s for that work before it replies. The client asks again while anything is still
  pending, up to 6 rounds.
  - Trigger: the reply stream's end already calls `load()`, so asking right after a load shows a
    new reply's suggestions without an extra polling loop.
- **Rationale**:
  - Turning suggestions off (FR-012) means no AI calls at all. That matters for the subscription
    setup, following the `SUMMARY_TRIGGER=map` precedent.
  - Old conversations get suggestions the first time they're opened, with no backfill job.
  - Starting right after the reply ends costs only one local round trip compared with starting
    the work on the server as soon as the reply completes.
- **Queue**: the same in-process queue shape as `summaries/queue.ts` and
  `definitions/draftQueue.ts`: at most 2 jobs at once, one job per message at a time, newest
  messages first.
- **SC-005 (3 s)**: plausible for the API setup with low effort and a short output. The reply stays
  readable and selectable the whole time either way (FR-011).
  - **Measured 2026-09-27 (T026)**: three direct `suggestSpans` calls through the Claude Code CLI
    setup took **3.7 s, 3.5 s and 2.9 s**. That's right at the target, and doesn't count the
    endpoint round trip.
  - **Quality**: the two substantive replies each got 3 well-chosen phrases, and all 6 matched
    exactly and survived validation. The one-line reply ("The capital of France is Paris") got
    `NONE`, as intended.

## R5. Failure handling: no error shown, and a cooldown

- **Decision**: An `AIUnavailableError` or a parse failure leaves no cache row. The message id goes
  into an in-memory `failedAt` map, and the message isn't retried or reported as pending for 5
  minutes. The chat shows nothing for that message (Edge Case "Detection unavailable").
- **Rationale**: Without a cooldown, every 4 s poll would call the AI again for a message that
  keeps failing.

## R6. Rendering: a third range kind in `splitByMarkers`

- **Decision**: Pass a message's suggested ranges into `splitByMarkers` alongside markers and
  terms. Each segment gets a `suggested` flag. `segmentAttributes` adds class `suggest-mark` and
  `data-suggest="<start>-<end>"`. This works for both `rehypeSourceOffsets` (AI markdown) and
  `PlainText`, though only AI messages ever receive ranges (FR-007).
- **Style (FR-002, FR-010, SC-003)**:
  - The dotted grey line is a `background-image` (radial-gradient dots along the bottom edge,
    `var(--muted)`, about 1 px, set in `globals.css`).
  - Branch markers use `background-color` and `border-bottom`. Definition terms use
    `text-decoration`. The three use different CSS properties, so a segment covered by all three
    shows all three without one overriding another.
  - The suggestion is the thinnest and lowest-contrast of the three.
- **Alternatives considered**: using `text-decoration` for suggestions too. It clashes with
  `.term-mark` on shared segments, because an element has only one text-decoration line style.

## R7. Click behavior: build a DOM range and let the existing toolbar take over

- **Decision**:
  - **Where clicks go**: `ChatView.onListClick` is extended. The order is:
    1. `[data-markers]`: open the branch, as today (FR-010).
    2. `.term-mark`: do nothing, so the term keeps its own hover and lock behavior (US2 AS2).
    3. `[data-suggest]` with a collapsed selection: select the suggestion. A non-collapsed
       selection means the user dragged, so it's left alone (FR-011).
  - **Selecting**: a new helper, `rangeForOffsets(messageEl, start, end)` in `selection.ts`, is
    the inverse of `rawOffset`. It finds the `span[data-start]` elements that hold `start` and
    `end` and builds a DOM `Range`. The click handler calls `removeAllRanges()` and then
    `addRange(range)`.
  - **Toolbar**: the resulting `selectionchange` runs `BranchAction`'s existing handler. That
    handler turns the range back into an `Anchor` through `selectionToAnchor`, so Define and
    Branch get exactly what a manual drag would give them (FR-004, FR-005, SC-002). No new
    toolbar code is needed.
- **Rationale**: going back and forth through the real DOM selection is what makes the click
  "identical to a manual selection". A unit test checks that
  `selectionToAnchor(rangeForOffsets(...))` returns the same start, end and text.

## R8. The on/off setting (FR-012)

- **Decision**: a per-browser setting, `showSuggestions` (default `true`), in a small zustand
  store with `persist` to `localStorage` (`farabi.settings`). A toggle button in the chat header
  (`aria-pressed`, label "Suggestions") flips it. When it's off, the chat sends no suggestions
  requests and draws no underlines.
- **Rationale**: this is a display switch, like the per-browser project cookie from Feature 4. It
  doesn't personalize how the AI suggests, so Article VI's rule against tuning AI behavior from
  stated preferences doesn't apply. It also satisfies Article IV's "able to stay quiet".
- **Hydration**: the store is read after mount. Before hydration the app assumes the default (on),
  and no request goes out before mount anyway.
