# Contract: HTTP changes

All additive; existing clients (no `terms`) behave exactly as before.

| Route | Request change |
|-------|----------------|
| `POST /api/trees` | `{ projectId, content, terms?: string[] }` |
| `POST /api/nodes/:id/ask` | `{ content, terms?: string[] }` |
| `POST /api/edges/:id/send` | `{ content, terms?: string[] }` |

- `terms` is a list of term ids, max 6. Validation is `checkSelection`; failure → `422`
  `{ error: { code: "invalid_request", message: <reason> } }` and nothing is stored.
- On success the created question edge has `lexicon: [{id, v}]`, and its pending answer has the
  uses it will be sent. An empty or absent list stores nothing.
- `"????"` quick-branch ignores `terms` from the request and copies the re-asked edge's uses.
- Retry/regenerate (`POST /api/edges/:id/attempts`): the new answer records the edge's term ids at
  their current versions.

`Element` gains `lexicon?: Array<{ id: string; v: number }>` (question edges and answers).

Method functions are reachable through the existing routes: `GET /api/nodes/:id/functions` lists
`premortem`, `steelman`, `scqa` for answers; `POST /api/nodes/:id/functions/:fn/run` runs them.
