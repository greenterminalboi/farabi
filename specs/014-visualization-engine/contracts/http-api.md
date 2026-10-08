# HTTP API: POST /api/viz/generate

Local requests only (`withApi`). Writes nothing in any case.

## Request

```json
{ "text": "def f(n): ...", "family": "auto", "model": "default" }
```

- `text`: string, 1–20,000 chars after trimming.
- `family`: `auto` (default) | `code` | `algorithm` | `argument`.
- `model`: optional, one of the app's reply model ids (`src/shared/models.ts`); `default` or absent
  uses the provider's default.

## Responses

| Status | Body | When |
|---|---|---|
| 200 | `{ "scene": Scene }` (origin `ai-suggested`) | valid scene, first or second try |
| 422 | `{ error: { code: "invalid_request" } }` | bad body, empty or oversized text |
| 422 | `{ error: { code: "provider_not_ready" }, provider, reason, settingsPath: "/settings#provider" }` | `providerReady()` failed; no AI call made |
| 503 | `{ error: { code: "viz_unavailable", message: "The AI couldn't produce a usable visualization. Nothing was created. Try again." } }` | provider failed, or both replies invalid |

The client cancels an earlier request when Generate is pressed again (AbortController); the server
passes the request's signal to the provider.
