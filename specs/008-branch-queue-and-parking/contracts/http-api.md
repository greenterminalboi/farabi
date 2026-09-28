# Contract: HTTP API changes

The same rules apply as before: local requests only, `{ error }` bodies, and no DELETE or PATCH.
The zod schemas live in `src/shared/schemas.ts`, and the client methods in `src/lib/api.ts`.

## Shared shape

```ts
ParkedTangent = {
  id: string;
  nodeId: string;
  anchor: Anchor;          // { messageId, start, end, text, prefix, suffix }, as for Branch
  question: string | null; // current typed question, exactly as typed; null = none
  createdAt: string;
}
```

## `POST /api/nodes/{nodeId}/parked`: park a tangent (FR-006, FR-007, FR-011)

- **Body**: `Anchor & { question?: string | null }`
- **What it does**: validates the anchor exactly as Branch does. It then inserts a tangent and,
  if the question isn't blank, a `question_set` event. No node, marker or message is created.
- **201**: `{ parked: ParkedTangent }`
- **404**: the node doesn't exist.
- **422** (`invalid_selection`): the selection is outside the message, empty, or doesn't match
  the text.
- **409** (`message_not_branchable`): the message is pending, failed or replaced.

## `POST /api/parked/{id}/question`: edit the typed question (FR-015)

- **Body**: `{ question: string | null }`. Blank or whitespace-only text is stored as null (the
  question is cleared).
- **200**: `{ parked: ParkedTangent }`
- **404**: unknown id.
- **409** (`parked_consumed`): already fired or discarded.

## `POST /api/parked/{id}/discard`: discard (FR-015, US4-3)

- **Body**: none.
- **200**: `{ discarded: { id: string } }`
- **404**, **409** (`parked_consumed`)

## `POST /api/parked/{id}/fire`: turn it into a real branch (FR-012–FR-014)

- **Body**: none.
- **201**, when the item has a question (FR-012):
  ```ts
  { kind: "sent"; node: MapNode; marker: Marker; userMessage: Message; aiMessage: Message }
  ```
  `userMessage.content` is exactly the stored question. `aiMessage` is `pending`, and it streams
  through the existing `/api/messages/{id}/stream`.
- **201**, when the item has no question (FR-013):
  ```ts
  { kind: "preload"; node: MapNode; marker: Marker; draft: string } // draft = anchor.text
  ```
- **404**: unknown id.
- **409** (`parked_consumed`): already fired or discarded. A second click gets this; it never
  creates a second branch.
- **409** (`message_not_branchable`): the anchor message can no longer be branched (a guard only;
  research R6 prevents this case).
- **Note**: an unreachable AI service is not an HTTP error here. The branch and the message are
  committed, and the reply fails asynchronously, as for any send (US2-4).
- **Test support**: `?wait=1` behaves as it does on `POST /api/nodes/{id}/messages`, for the
  `sent` kind only.

## Changed responses

`NodeView` (`GET /api/nodes/{nodeId}`) gains:

```ts
children: MapNode[];     // direct children only, newest first (FR-002)
parked: ParkedTangent[]; // live items parked from this node, newest first (FR-003)
```

`canRegenerate` is also `null` when the latest reply has a live parked item.

`POST /api/messages/{id}/regenerate` has a new failure: **409** (`has_parked`) when the reply
has live parked items (research R6).

## Unchanged

- `POST /api/nodes/{nodeId}/branches` keeps its request and response. The optional question in
  the Branch flow never reaches the server: it only preloads the new branch's composer, on the
  client (research R4).
- Quick branch (`????`) keeps its request and response (FR-016).

## Client methods (`src/lib/api.ts`)

- `park(nodeId, anchor, question)`
- `setParkedQuestion(id, question)`
- `discardParked(id)`
- `fireParked(id)`
