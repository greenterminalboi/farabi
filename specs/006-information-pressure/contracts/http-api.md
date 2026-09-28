# Contract: HTTP API changes

The same rules apply as before: local requests only, `{ error }` bodies, and no DELETE or PATCH.

## `GET /api/settings`

```ts
200 {
  informationPressure: number;   // 1–10, default 8
  replyModel: ReplyModelChoice;  // "default" or a listed model ID
  models: Array<{ id: ReplyModelChoice; label: string }>; // REPLY_MODELS, in order
}
```

## `PUT /api/settings`

- **Request body**: `{ informationPressure?: number; replyModel?: string }`, with at least one
  field.
  - `informationPressure` must be an integer from 1 to 10.
  - `replyModel` must be one of the `REPLY_MODELS` IDs.
- **What it does**: appends one `setting_changes` row for each field whose value differs from the
  current one. Sending an unchanged value writes nothing.
- **200**: the same body as the GET.
- **422** (`invalid_request`): an empty body, a non-integer, a level out of range, or an unknown
  model ID.

## Changed responses

`Message` (in `NodeView.messages`, `SendMessageResponse`, stream `end` events and so on) gains:

```ts
pressureLevel: number | null; // null for user messages and replies from before this feature
replyModel: string | null;    // resolved model ID; null when "Default" couldn't be resolved
```

`src/lib/api.ts` gets `getSettings()` and `saveSettings(patch)`, using the zod schemas
`SettingsResponse` and `SaveSettingsBody` in `src/shared/schemas.ts`.
