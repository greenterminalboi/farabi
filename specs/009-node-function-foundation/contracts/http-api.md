# Contract: HTTP API changes

The same rules apply as before:

- local requests only
- `{ error: { code, message } }` bodies
- no DELETE or PATCH

The zod schemas live in `src/shared/schemas.ts`, and the client methods in `src/lib/api.ts`.

## Shared shapes

```ts
NodeKind = string;                        // a registered kind id: "conversation" | "analogy" | "pipe" today
Review = "proposed" | "confirmed" | "rejected";

MapNode = {                               // existing fields unchanged, plus:
  kind: NodeKind;
  origin: "root" | "branch" | "quick_branch" | "parked" | "function";
  output: OutputSummary | null;           // null for conversation-backed kinds
};
// For output nodes, `summary` is { kind: "placeholder", text: "" } and is ignored: the label comes
// from output.displayedText (FR-006, FR-018). isRoot = kind === "conversation" && parentId === null.

OutputSummary = {
  functionId: string;
  pipeId: string;
  inputNodeId: string;
  displayedText: string;                  // confirmed version if confirmed, else latest
  provenance: "ai_suggested" | "user_confirmed";
  review: Review;
  stale: boolean;                         // latest version's source version ≠ input's current (no AI call)
  pendingDraft: boolean;                  // confirmed, with a newer ai_suggested version waiting
  versionCount: number;
};

MapPipe = {
  id: string;                             // the pipe node's id
  treeId: string;
  inputNodeId: string;
  outputNodeId: string;
  reads: "summary" | "conversation" | "anchor";
  functionId: string;
  functionName: string;
  functionVersion: number;
  state: Review;                          // = the output's review
  createdAt: string;
};

OutputVersion = {
  id: string;
  text: string;
  sourceVersion: string;
  functionVersion: number;
  settings: Record<string, string>;
  provenance: "ai_suggested";
  confirmed: boolean;                     // named by the newest confirm event
  createdAt: string;
};

ResolvedSetting = {
  key: string;
  value: string;
  source: "override" | "kind" | "default";
  kindValue: string | null;               // kind-level value, if set
  changedAt: string | null;               // time of the row in effect at its scope
};
```

## Changed endpoints

### `GET /api/forest`

- **200**: `{ trees: MapTree[]; nodes: MapNode[]; pipes: MapPipe[] }`
- `nodes` now also includes output nodes. `pipes` is new.
- Rejected outputs and their pipes are included, with `review` or `state` set to `"rejected"`.
  The client hides them unless "Show rejected" is on.
- Staleness is computed in SQL. No AI call is made (FR-022, SC-004).

### `GET /api/nodes/{nodeId}`

- **200**: `NodeView`, unchanged for conversation nodes. `node` gains `kind`, `origin` and
  `output: null`. `children` still lists only conversation children (FR-017).
- **409** (`wrong_kind`): the node isn't conversation-backed. The body also carries
  `{ kind: NodeKind }`.

### Conversation-only endpoints (FR-005)

These now answer **409** (`wrong_kind`) for a node of any non-conversation kind:

- `POST /api/nodes/{id}/messages`
- `POST /api/nodes/{id}/branches`
- `POST /api/nodes/{id}/parked`
- `POST /api/definitions` (`nodeId`)
- `POST /api/nodes/{id}/summary/refresh`

Their bodies and success responses are unchanged.

### `PUT /api/nodes/{nodeId}/position`

- Output nodes are accepted and have no root restriction (FR-039).
- Pipe nodes get **409** (`wrong_kind`). A pipe has no position of its own; it follows its
  endpoints.

### `PUT /api/nodes/{nodeId}/edge-label`

- **409** (`root_node`) for any node that isn't a conversation child, as before for roots.

## New endpoints

### `GET /api/nodes/{nodeId}/functions`: the function menu (FR-009, FR-010)

- **200**:
  ```ts
  { functions: Array<{ id: string; name: string; version: number; outputKind: NodeKind;
                       available: boolean; reason: string | null }> }
  ```
  Only functions whose `accepts` contains the node's kind are listed. It is an empty list for
  analogy and pipe nodes.
- **404**: unknown node.

### `POST /api/nodes/{nodeId}/functions/{functionId}/run`: run a function (FR-009–FR-013)

- **Body**: none. A new output uses the output kind's kind-level settings or defaults (R7).
- **201**: `{ output: MapNode; pipe: MapPipe }`. Both are `ai_suggested`, in the input's tree and
  project.
- **404**: unknown node or function, or the node's project is in the trash.
- **409**:
  - `wrong_kind`: the function doesn't accept this node's kind.
  - `function_unavailable`: for example, no summary yet. The message is the reason.
- **503** (`ai_unavailable`): the completion failed. Nothing was created, and the input is
  untouched (FR-012). The client shows the message with Retry, which repeats the same request.

### `GET /api/nodes/{outputId}/output`: the output view (FR-019)

- **200**:
  ```ts
  {
    node: MapNode;                        // kind analogy, with output summary
    pipe: MapPipe;
    versions: OutputVersion[];            // newest first, all kept (FR-025)
    input: { node: MapNode; messages: Message[] };   // read-only conversation
    settings: ResolvedSetting[];          // for this node: override → kind → default (FR-031)
  }
  ```
- **404**: unknown node.
- **409** (`wrong_kind`): not a function output.

### `POST /api/nodes/{outputId}/output/regenerate` (FR-023–FR-026)

- **Body**: none.
- Reads the input's current source and resolves settings, including this node's override. It
  then runs the output's function at its current definition version.
- **201**: `{ output: MapNode; version: OutputVersion }`. The review state is unchanged: a
  confirmed output stays confirmed, and the new version is a pending draft.
- **409** (`function_unavailable`): for example, the input now has no summary. Nothing is added.
- **503** (`ai_unavailable`): nothing is added, and the current version stays.

### `POST /api/nodes/{outputId}/output/confirm` (FR-027, US3 AS1, FR-026)

- **Body**: `{ versionId: string }`
- **200**: `{ output: MapNode }`, with `review` set to `"confirmed"`.
- **409**:
  - `not_latest`: `versionId` isn't the newest version.
  - `already_confirmed`: that version is already confirmed and the output isn't rejected. No
    row is written.
- **404**: unknown output or version.

### `POST /api/nodes/{outputId}/output/reject` (FR-027, US3 AS2)

- **Body**: none.
- **200**: `{ output: MapNode }`, with `review` set to `"rejected"`. Nothing is deleted.
- **409** (`already_rejected`).

### `GET /api/nodes/{pipeId}/pipe`: the pipe view (FR-017)

- **200**:
  ```ts
  { pipe: MapPipe; input: MapNode; output: MapNode; versionCount: number; stale: boolean }
  ```
- **409** (`wrong_kind`): the node isn't a pipe.

### `GET /api/kind-settings`: the Settings page sections (FR-031)

- **200**:
  ```ts
  { kinds: Array<{ kind: NodeKind; settings: ResolvedSetting[] }> }
  ```
  Only kinds that declare settings are listed. There is no node here, so `source` is `kind` or
  `default`.

### `PUT /api/kind-settings`: set or clear a kind-level value (FR-032)

- **Body**: `{ kind: NodeKind; key: string; value: string | null }`. `null` clears the value
  back to the default.
- **200**: the same shape as `GET`.
- **422** (`invalid_request`): unknown kind or key, or a value that isn't one of the choices.
- No function runs as a result (SC-008). An unchanged value writes no row.

### `PUT /api/nodes/{nodeId}/settings`: set or clear a per-node override (FR-031, FR-033)

- **Body**: `{ key: string; value: string | null }`
- **200**: `{ settings: ResolvedSetting[] }`
- **404**: unknown node.
- **422**: the key isn't declared by this node's kind, or the value isn't allowed.
- No function runs as a result.
