# Contract: HTTP API changes

The same rules apply as before: local requests only, `{ error }` bodies, and POST for anything
that may write. This route may write cache rows.

## `POST /api/nodes/{nodeId}/suggestions`

Returns the cached suggestions for the node's live, complete AI messages. It queues analysis of
the messages that have none yet and waits up to 5 s for them.

- **Request body**: `{}`
- **200 response**:

```ts
{
  /** Every live, complete AI message that has been analyzed; [] means "nothing to suggest". */
  byMessage: Record<string, Array<{ start: number; end: number; text: string }>>;
  /** Messages still being analyzed after the wait. Failed messages in cooldown are not listed. */
  pending: string[];
}
```

- **404**: the node doesn't exist.
- **Never includes**:
  - user messages (FR-007)
  - pending, incomplete, stopped or failed messages (FR-003)
  - replaced messages
- **Side effects**: at most, inserts into `span_suggestions`. It never touches any other table
  (FR-006, FR-009, SC-004).
- **Client use**: called only while `showSuggestions` is on. It's called again after each
  `getNode` load that shows a complete AI message not yet in `byMessage`, and repeated while
  `pending` isn't empty, for at most 6 rounds per load.

## Schemas (`src/shared/schemas.ts`)

```ts
export const SuggestedSpan = z.object({ start: z.number().int(), end: z.number().int(), text: z.string() });
export const SuggestionsResponse = z.object({
  byMessage: z.record(z.string(), z.array(SuggestedSpan)),
  pending: z.array(z.string()),
});
```

`api.getSuggestions(nodeId)` is added to `src/lib/api.ts`.
