# Quickstart & Validation: Suggested Branch Underlines

Run the app as in Feature 1 (`README.md`): `docker compose up -d`, `npm run db:migrate` (adds
`span_suggestions`, see [data-model.md](./data-model.md)), then `npm run dev`. Automated tests use
the fake provider (see [contracts/ai-provider.md](./contracts/ai-provider.md)). Run scenario 1 once
by hand with `AI_PROVIDER=claude-code` or `claude` to judge whether the real suggestions are good
ones.

## Validation scenarios

Each scenario maps to a user story. They're checked by `tests/integration/f5-suggestions.test.ts`
and `tests/e2e/f5-suggestions.spec.ts`.

1. **Suggestion appears and hands off (US1, SC-001, SC-002)**
   - Send "Pods". When the reply completes, "Containers are mentioned here." has a `suggest-mark`.
     "Echo: Pods." does not.
   - Click the suggestion. The toolbar shows Define and Branch, and `getSelection().toString()`
     equals the span text.
   - Click Branch. A branch opens whose anchor is exactly that text, the same as a manual drag
     over it.
2. **Nothing while streaming or ended early (FR-003)**
   - With `chunkDelayMs: 400`, no `suggest-mark` shows during streaming.
   - Stop a reply, then make one stall. Neither shows a `suggest-mark`. The user's own message
     never shows one either.
3. **Nothing stored (SC-004, FR-006)** (integration)
   - Count rows in every table except `span_suggestions`, call the endpoint, drain the queue and
     count again. The counts are equal.
   - Call the endpoint a second time. The fake records no new `suggestSpans` call, because the
     cache is used (FR-013, SC-006).
4. **Coexistence (US2, FR-010)**
   - Capture "Containers" as a definition. That word shows both `term-mark` and `suggest-mark`.
     Hovering it shows the term card, and clicking it does not select the suggestion. Clicking
     "mentioned" selects the whole suggestion.
   - Branch from the suggestion, then reload. The text shows both `marker` and `suggest-mark`.
     Clicking it opens the child branch, as markers already do.
5. **Toggle (FR-012)**
   - Turn Suggestions off. Every `suggest-mark` disappears and no suggestions request is sent.
     Reload: it's still off.
   - Turn it back on. The underlines come back from the cache.
6. **Unavailable (Edge Case)**
   - Set the fake to `fail`, then send a message. No underline and no error message appear.
     Manual selection still works.

## Unit checks

- `locateSpans`:
  - exact match, first occurrence
  - paraphrased phrases are dropped
  - word and length limits
  - markdown characters and line breaks
  - overlap removal
  - the cap of 3
- `parseSpans`: `SPAN:` lines, `NONE`, and unparseable output.
- `splitByMarkers` with markers, terms and suggestions together: the segment flags are correct.
- `selectionToAnchor(rangeForOffsets(el, s, e))` returns `{ start: s, end: e }` for a span that
  crosses a bold element and one that crosses a marker boundary.

## Constitution spot checks

- The guard test extends to: `span_suggestions.provenance` is always `ai_suggested`; no code
  updates or deletes `span_suggestions`; `src/server/suggestions/` never inserts into `nodes`,
  `branch_markers`, `definitions` or `messages`.
- Existing guards stay green: no DELETE or PATCH, and only message services call `reply`.
