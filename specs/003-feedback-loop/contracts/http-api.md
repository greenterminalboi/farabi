# Contract: Feedback HTTP API

Extends `specs/001-branching-chat-map/contracts/http-api.md` and
`specs/002-map-definitions-streaming/contracts/http-api.md`. The same rules apply:

- local requests only (`withApi`);
- JSON bodies are validated with shared Zod schemas, except the one multipart upload;
- errors are returned as `{ error: { code, message } }`;
- there are **no DELETE or PATCH endpoints**, which the existing constitution test keeps checking;
- no endpoint in this contract calls an AI provider (FR-021).

## Shared shapes (`src/shared/schemas.ts`)

```ts
type FeedbackState = "open" | "addressed" | "resolved";
type FeedbackView  = "chat" | "map" | "definitions";

type FeedbackStateEvent = {
  state: FeedbackState;
  provenance: "user_authored" | "ai_suggested" | "user_confirmed";
  at: string;                                  // ISO time
};

type FeedbackAttachment = {
  id: string;
  url: string;                                 // /api/feedback/attachments/{id}
  thumbUrl: string;                            // /api/feedback/attachments/{id}?thumb=1
  path: string;                                // relative to the repo root, as written in FEEDBACK.md
  mimeType: string;
  byteSize: number;
  createdAt: string;
};

type FeedbackItem = {
  id: string;
  text: string;
  context: { view: FeedbackView; nodeId: string | null };
  tags: Array<{ text: string; key: string }>;
  attachments: FeedbackAttachment[];
  state: FeedbackState;                        // = history[history.length - 1].state
  history: FeedbackStateEvent[];               // oldest first, never shortened
  manuallyPlaced: boolean;                     // rank is set
  createdAt: string;
};
```

## `GET /api/feedback`

**200** `{ items: FeedbackItem[] }`, every item in any state, already in panel order (research R3).
Tag filtering happens in the browser.

## `POST /api/feedback`

`multipart/form-data` fields:

| Field | Required | Content |
|-------|----------|---------|
| `text` | yes | non-empty after trimming, at most 20,000 characters |
| `view` | yes | `chat` \| `map` \| `definitions` |
| `nodeId` | no | uuid; only allowed with `view = chat` |
| `tags` | no | JSON array of strings, each 1–60 characters after trimming; duplicates by key are dropped |
| `image` | no, repeatable | image file, at most 10, each at most 10 MB, PNG/JPEG/WebP/GIF by magic bytes |
| `thumb` | no, repeatable | WebP thumbnail; `thumb[i]` belongs to `image[i]` |

Responses:

- **201** `{ item: FeedbackItem }`: the item, its first `open` state event (`user_authored`), and
  its tags and attachments, all stored in one transaction. `FEEDBACK.md` has been regenerated
  before the response is sent.
- **422** `invalid_request`: empty text, a bad view or node combination, an unknown node, a bad tag,
  too many images, or an image that is too large or of an unsupported type. Nothing is stored.

## `PUT /api/feedback/{id}/position`

Body `{ aboveId: string | null, belowId: string | null }`. These are the items shown directly above
and below the drop point (research R3 and R10). They cannot both be null unless the list has only
this one item.

- **200** `{ item: FeedbackItem }`: only this item's `rank` changed.
- **404** `not_found`: the item, or one of the neighbours, does not exist.
- **422** `invalid_request`: `aboveId` does not sort above `belowId`, or a neighbour is the item
  itself.

## `POST /api/feedback/{id}/resolve`

The user confirms an item (FR-013, FR-014). Allowed from `open` or `addressed`; adds a `resolved` /
`user_confirmed` event.

- **200** `{ item }`
- **409** `invalid_transition`: the item is already `resolved`.

## `POST /api/feedback/{id}/reopen`

Allowed from `addressed` or `resolved` (FR-015); adds an `open` / `user_authored` event.

- **200** `{ item }`
- **409** `invalid_transition`: the item is already `open`.

There is intentionally **no** endpoint that sets `addressed`. That transition belongs to the script
in [feedback-file.md](./feedback-file.md).

## `GET /api/feedback/attachments/{id}`

Streams the stored image with its `Content-Type` and `Cache-Control: private, max-age=31536000,
immutable`, which is safe because files never change. `?thumb=1` streams the thumbnail, or the
original if there is none.

- **404** `not_found`: unknown id, or the file is missing on disk. A missing file is logged; it
  should not happen, since nothing in this feature removes files.
