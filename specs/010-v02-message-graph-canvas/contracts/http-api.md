# HTTP API: Farabi v0.2

All routes are Next 16 App Router handlers under `src/app/api/`, wrapped by `withApi`. Request
and response shapes are zod schemas in `src/shared/schemas.ts`.

- **Errors** keep the existing shape: `{ error: { code, message, details? } }`, with status 400,
  404, 409 or 503.
- **No DELETE or PATCH handlers** exist (Article II, guard test).
- Ids are uuids.
- Routes that existed only for the chat and map model are removed (see the end of this file).

## Shared shapes

```ts
type Shape = "node" | "edge";
type EdgeState = "unsent" | "replying" | "answered" | "incomplete" | "stopped" | "failed";
type Review = "proposed" | "confirmed" | "rejected";

type Span = { start: number; end: number; text: string; prefix: string; suffix: string };

type Element = {
  id: string;
  treeId: string;
  parentId: string | null;
  kind: string;             // "question" | "answer" | "function" | "analogy" | later kinds
  shape: Shape;
  origin: "origin" | "ask" | "branch" | "quick_branch" | "parked" | "reply" | "retry" | "regenerate" | "run";
  provenance: "ai_suggested" | "user_confirmed" | "user_authored";
  text: string | null;      // null: unsent question edge, or a function edge
  createdAt: string;
  manual: { x: number; y: number } | null;
  // question edges
  state?: EdgeState;
  anchor?: Span | null;     // where a branch or parked edge leaves its parent's text
  requeryOf?: string | null;
  note?: string | null;     // current edge note (FR-040)
  // answers
  status?: "pending" | "complete" | "incomplete" | "stopped" | "failed";
  partialText?: string | null;
  pressureLevel?: number | null;
  replyModel?: string | null;
  // function edges and outputs
  functionId?: string;
  functionName?: string;
  functionVersion?: number;
  review?: Review;          // outputs: newest review. Function edges: derived from their outputs.
};

type Tree = { id: string; origin: { x: number; y: number }; userPlaced: boolean; rootAnswerId: string | null };
type Camera = { x: number; y: number; scale: number };
```

`Element.provenance` is the creation provenance. Review state is always shown through `review`, so
no client can render a proposed output as confirmed (Article I).

## Canvas

| Method and path | Body | Response | Notes |
|-----------------|------|----------|-------|
| GET `/api/canvas?projectId=` | | `{ trees: Tree[], elements: Element[], camera: Camera \| null }` | Every element of the project, with full text (research R13). Rejected outputs are included, and the client hides them (FR-050). Pending answers with no live generator are finalized as `incomplete` first (orphan rule). |
| PUT `/api/projects/{id}/camera` | `Camera` | `{ camera }` | Called after the camera has been idle for 500 ms (FR-028). |
| PUT `/api/trees/{id}/origin` | `{ x, y }` | `{ tree }` | Sets `user_placed` (FR-037, FR-038). |
| PUT `/api/nodes/{id}/position` | `{ x, y }` | `{ element }` | Relative to the tree origin. Refused for the origin edge (409 `origin_edge`: "move the tree instead"). Never touches structure. |

## Asking

| Method and path | Body | Response | Notes |
|-----------------|------|----------|-------|
| POST `/api/trees` | `{ projectId, content }` | `{ tree, edge, answer }` | Starts a tree: an origin edge plus a pending answer. Any text is accepted (FR-005, FR-014). The reply starts after commit. |
| POST `/api/nodes/{id}/ask` | `{ content }` | `{ kind: "message", edge, answer }` or `{ kind: "quick_branch", edge, answer }` | From an answer, or from a sent edge whose newest attempt isn't pending. `content === "????"` with a valid quick branch → the second shape (FR-020). Otherwise an ordinary message. 409 `reply_in_progress`, 409 `not_askable` (function output or unsent edge). |
| POST `/api/nodes/{id}/branches` | `Span` without prefix and suffix (the server computes them) | `{ edge }` | Creates an unsent edge anchored to the span (FR-017). The AI is never called. 400 `invalid_selection`, 409 `not_branchable`. |
| POST `/api/edges/{id}/send` | `{ content }` | `{ edge, answer }` | Sends an unsent edge once. 409 `already_sent`. `????` is not special here, since an unsent branch has no attempt to re-ask. |
| POST `/api/edges/{id}/attempts` | `{ mode: "retry" \| "regenerate" }` | `{ answer }` | A new sibling answer (FR-041, FR-042). 409 `not_retryable` when the newest attempt isn't incomplete, stopped or failed. 409 `not_regenerable` when there is no complete attempt. |
| POST `/api/answers/{id}/stop` | | `{ answer }` | Stops the stream and keeps the text as `stopped` (FR-011). |
| GET `/api/answers/{id}/stream` | | SSE: `snapshot {text}`, `delta {text}`, `end {answer}` | Same event names as Feature 2. |

`?wait=1` on the POST routes resolves after the reply ends (tests only, as today).

## Notes

| Method and path | Body | Response |
|-----------------|------|----------|
| PUT `/api/edges/{id}/note` | `{ text: string \| null }` | `{ edge }` |

Text is trimmed with whitespace collapsed, at most 200 characters, and an empty value clears the
note. Every call appends a version (FR-040). 409 `not_an_edge`.

## Side panel

| Method and path | Response | Notes |
|-----------------|----------|-------|
| GET `/api/nodes/{id}/panel` | `{ children: Element[], parked: ParkedTangent[] }` | Direct child edges, newest first, and live parked tangents of the focused element (FR-022). |

## Parked tangents (Feature 8, re-targeted)

| Method and path | Body | Response |
|-----------------|------|----------|
| POST `/api/nodes/{id}/parked` | `Span` without prefix and suffix, plus `{ question?: string }` | `{ parked }` |
| PUT `/api/parked/{id}/question` | `{ question: string \| null }` | `{ parked }` |
| POST `/api/parked/{id}/discard` | | `{ parked }` |
| POST `/api/parked/{id}/fire` | | `{ kind: "sent", edge, answer }` or `{ kind: "preload", edge, draft }` |

`ParkedTangent = { id, nodeId, anchor: Span, question: string | null, createdAt }`.

## Definitions (Feature 2, re-targeted)

- `POST /api/definitions` takes `{ nodeId, start, end, text }`. The node may be any element with
  final text (FR-055).
- The definition's `source` becomes `{ elementId, kind, excerpt, projectId }`.
- The other definition routes are unchanged.

## Functions, reviews and settings (Feature 9, re-expressed)

| Method and path | Body | Response | Notes |
|-----------------|------|----------|-------|
| GET `/api/nodes/{id}/functions` | | `{ functions: [{ id, name, version, outputKind }] }` | Only functions that accept the element's kind (story 8). |
| POST `/api/nodes/{id}/functions/{functionId}/run` | | `{ edge, output }` | A new function edge and its first output. 503 `function_unavailable` writes nothing (FR-052). |
| POST `/api/edges/{id}/rerun` | | `{ output }` | Another output under an existing function edge, using its override (FR-051, FR-053). |
| POST `/api/nodes/{id}/confirm` | | `{ output }` | Output only. Appends `confirmed`. |
| POST `/api/nodes/{id}/reject` | | `{ output }` | Output only. Appends `rejected`. |
| GET `/api/kind-settings` | | `{ kinds: [{ kind, label, settings: ResolvedSetting[] }] }` | Kinds that declare settings (FR-053). |
| PUT `/api/kind-settings` | `{ kind, key, value }` | `{ setting }` | Never starts a run. |
| PUT `/api/edges/{id}/settings` | `{ key, value: string \| null }` | `{ setting }` | Override on a function edge. `null` clears it. |

## Feedback (Feature 3)

`POST /api/feedback` adds `projectId` and `elementId` and uses `view: "canvas"` from the canvas.
The rest is unchanged.

## Removed

These routes are removed:

- `GET /api/forest`
- `GET /api/nodes/{id}` (chat view)
- `POST /api/nodes/{id}/messages`
- `/api/messages/{id}/regenerate|retry|stop|stream`
- `PUT /api/nodes/{id}/edge-label`
- `/api/nodes/{id}/output*`
- `GET /api/nodes/{id}/pipe`
- `PUT /api/nodes/{id}/settings`
- `POST /api/nodes/{id}/summary/refresh`
- `POST /api/summaries/refresh-stale`

`/api/projects*`, `/api/settings`, `/api/feedback*` and `/api/test/ai-mode` stay.
