# Contract: Local HTTP API

> Feature 2 changed and extended this API (asynchronous sending, streaming, quick branch,
> positions, edge labels, definitions): see `specs/002-map-definitions-streaming/contracts/http-api.md`.

Served by Next.js route handlers on the local server (research R1), bound to `127.0.0.1`.
Requests with a foreign `Host` or `Origin` are rejected with `403`.
All bodies are JSON and validated with shared Zod schemas (research R12). Errors use
`{ "error": { "code": string, "message": string } }`.

There are **no** DELETE or PATCH endpoints for trees, nodes, markers or messages (FR-009, FR-028).

## Shared shapes

```ts
type Provenance = "ai_suggested" | "user_confirmed" | "user_authored";

type Summary =
  | { kind: "placeholder"; text: string }                        // FR-011; never styled as AI
  | { kind: "summary"; text: string; provenance: Provenance;     // "ai_suggested" in v1
      throughMessageId: string; createdAt: string };

type Anchor = { messageId: string; start: number; end: number;
                text: string; prefix: string; suffix: string };

type MapNode = { id: string; treeId: string; parentId: string | null;
                 isRoot: boolean; anchorText: string | null;
                 summary: Summary; createdAt: string };

type MapTree = { id: string; rootNodeId: string; origin: { x: number; y: number } };

type Message = { id: string; seq: number; role: "user" | "ai";
                 content: string; status: "pending" | "complete" | "failed";
                 provenance: Provenance; createdAt: string };

type Marker = { id: string; messageId: string; start: number; end: number;
                anchorText: string; childNodeId: string };
```

## Endpoints

### `GET /api/forest`

Whole forest for the map (FR-017, FR-021).
**200** `{ trees: MapTree[]; nodes: MapNode[] }`

### `POST /api/trees`

Start a root conversation (FR-001). Body: `{}`.
**201** `{ tree: MapTree; node: MapNode }` — origin assigned in the first free map region.

### `PUT /api/trees/{treeId}/origin`

Persist a tree's map origin after the client relocates a tree that outgrew its region
(research R4). Presentation data only; never changes structure.
Body: `{ x: number; y: number }` (finite). **200** `{ tree: MapTree }` | **404** | **422**.

### `GET /api/nodes/{nodeId}`

Everything the chat view needs for one node.
**200**
```ts
{
  node: MapNode;
  anchor: Anchor | null;                  // null for roots
  inheritedContext: {                     // FR-005, FR-033; [] for roots
    nodeId: string; messages: Message[];  // oldest ancestor first, cut at each branch point
  }[];
  messages: Message[];                    // this node's non-replaced messages, by seq
  markers: Marker[];                      // FR-006, FR-007
  canRegenerate: { messageId: string } | null;  // FR-029
}
```
**404** unknown node.

### `POST /api/nodes/{nodeId}/branches`

Branch from a selection (FR-002–FR-004, FR-008).
Body: `Anchor` (message must belong to `nodeId`).
**201** `{ node: MapNode; marker: Marker }`
**422** `invalid_selection` — empty/whitespace, out of range, crosses messages, or `text` does
not equal the message substring.
**409** `message_not_branchable` — message is pending, failed, or replaced.

### `POST /api/nodes/{nodeId}/messages`

Send a user message and obtain the AI reply (FR-004, FR-032).
Body: `{ content: string }` (non-empty).
**201** `{ userMessage: Message; aiMessage: Message }`
**503** `ai_unavailable` — the user message is stored; `aiMessage` absent; client offers retry.
*Transport (streaming vs. single response) is deferred with the AI layer (research R10); the
stored results and error semantics above are fixed.*

### `POST /api/messages/{messageId}/retry`

Retry a failed AI reply. **201** `{ aiMessage: Message }` | **503** `ai_unavailable`.

### `POST /api/messages/{messageId}/regenerate`

Regenerate the latest AI reply (FR-029, FR-030).
**201** `{ aiMessage: Message; replaced: { id: string; replacedAt: string } }`
**409** `not_latest_ai_message` | `has_branches` | **503** `ai_unavailable`.

### `POST /api/nodes/{nodeId}/summary/refresh`

Request summary regeneration for a node (FR-012, FR-013). Returns immediately.
**202** `{ queued: true }`. The new summary appears in later `GET /api/forest` /
`GET /api/nodes/{id}` responses. *When the client calls this (after each reply vs. on
exit-to-map) is deferred (research R10).*

### `POST /api/summaries/refresh-stale`

Queues a summary refresh for every node whose label predates its latest completed reply.
Called when the map opens; with `SUMMARY_TRIGGER=map` this is the only automatic trigger.
Returns immediately. **202** `{ queued: number }`.
