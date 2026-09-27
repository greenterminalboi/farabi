# Contract: Local HTTP API changes

Extends `specs/001-branching-chat-map/contracts/http-api.md`. Same rules: local requests only,
JSON bodies validated with shared Zod schemas, errors as `{ error: { code, message } }`, no DELETE
or PATCH endpoints.

## Shared shape changes

```ts
type Message = { ...; status: "pending" | "complete" | "failed" | "incomplete" | "stopped";
                 partialContent: string | null };          // text so far while pending

type Marker = { ...; kind: "selection" | "whole_message" };

type MapNode = { ...; manual: { x: number; y: number } | null;  // relative to the tree origin
                 edgeLabel: string | null };                    // label on the edge to its parent

type MapTree = { ...; userPlaced: boolean };

type DefinitionVersion = { generalText: string; usageText: string;
                           provenance: "ai_suggested" | "user_confirmed"; createdAt: string };

type Definition = { id: string; term: string; termKey: string;
                    source: { nodeId: string; messageId: string };
                    status: "drafting" | "failed" | "draft" | "confirmed";
                    current: DefinitionVersion | null; createdAt: string };
```

## Changed endpoints

### `POST /api/nodes/{nodeId}/messages`

Now returns as soon as both messages are stored; the reply streams separately.
Body `{ content }`.

- **201** `{ kind: "message", userMessage, aiMessage }` — `aiMessage.status = "pending"`.
- **201** `{ kind: "quick_branch", node: MapNode, marker: Marker, userMessage, aiMessage }` — for
  an exact `????` that could branch (FR-006–FR-012). `userMessage`/`aiMessage` belong to the new
  branch; the client navigates to `node.id`.
- `?wait=1` → responds only when the reply has ended (tests and scripts); `aiMessage` is then final.
- **409** `reply_in_progress` (unchanged).

### `POST /api/messages/{messageId}/retry`

Now also accepts `incomplete` and `stopped` messages. Returns **201** `{ aiMessage }` (pending).

### `PUT /api/trees/{treeId}/origin`

Body `{ x, y, byUser?: boolean }`. `byUser: true` also sets `userPlaced` (FR-020).

### `GET /api/forest`

Nodes carry `manual` and `edgeLabel`; trees carry `userPlaced`.

## New endpoints

### `GET /api/messages/{messageId}/stream` (Server-Sent Events)

```text
event: snapshot   data: { "text": "<text so far>" }          (always first)
event: delta      data: { "text": "<new text>" }             (zero or more)
event: end        data: { "message": Message }               (last; status is final)
```

A message that has already ended sends `snapshot` + `end` at once. An orphaned `pending` message
(no live generator) is finalised as `incomplete` from its checkpoint, then `end` is sent.

### `POST /api/messages/{messageId}/stop`

Stops a pending reply. **200** `{ message }` with `status: "stopped"`. **409** `not_streaming`.

### `PUT /api/nodes/{nodeId}/position`

Body `{ x, y }` (finite, relative to the tree origin). **200** `{ node: MapNode }`.
**409** `root_node` — a root is moved by moving its tree.

### `PUT /api/nodes/{nodeId}/edge-label`

Label on the edge from this node to its parent. Body `{ text: string | null }` (null or blank
clears). **200** `{ node: MapNode }`. **409** `root_node` (roots have no parent edge).

### `POST /api/definitions`

Capture a term. Body `{ nodeId, messageId, start, end, text }` (same selection checks as branching).
**201** `{ definition, created: true }` — drafting starts in the background.
**200** `{ definition, created: false }` — the term already exists (FR-034).

### `GET /api/definitions`

**200** `{ definitions: Definition[] }`, newest first. `?index=1` → `{ terms: { id, term, termKey }[] }`
for marking text (research R9).

### `GET /api/definitions/{id}`

**200** `{ definition: Definition, versions: DefinitionVersion[] }` (versions newest first).

### `POST /api/definitions/{id}/confirm`

Confirm the current draft unchanged. **201** `{ definition }` (`status: "confirmed"`).
**409** `nothing_to_confirm` when there is no version yet.

### `POST /api/definitions/{id}/versions`

Save an edit. Body `{ generalText, usageText }` (each trimmed, non-empty). **201** `{ definition }`
(`status: "confirmed"`).

### `POST /api/definitions/{id}/redraft`

Retry a failed draft. **202** `{ queued: true }`. **409** `already_drafted`.
