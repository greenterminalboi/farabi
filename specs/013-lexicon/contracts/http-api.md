# Contract: HTTP changes

All additive; existing clients (no `terms`) behave exactly as before.

| Route | Request change |
|-------|----------------|
| `POST /api/trees` | `{ projectId, content, terms?: TermInput[] }` |
| `POST /api/nodes/:id/ask` | `{ content, terms?: TermInput[] }` |
| `POST /api/edges/:id/send` | `{ content, terms?: TermInput[] }` |

`TermInput = string | { id: string; via: "detected" | "chip" }` (owner decision 2026-10-07). A bare
id is a chip added by hand (recorded as `via: "chip"`).

- `terms` has no maximum (the cap of 6 was removed on 2026-10-07). Validation is `checkSelection`
  (single-value slots, declared conflicts, unknown/retired/repeated ids); failure → `422`
  `{ error: { code: "invalid_request", message: <reason> } }` and nothing is stored.
- On success the created question edge has `lexicon: [{id, v, via}]`, and its pending answer has
  the uses it will be sent (`{id, v}`, no `via`). An empty or absent list stores nothing.
- `"????"` quick-branch ignores `terms` from the request and copies the re-asked edge's uses.
- Retry/regenerate (`POST /api/edges/:id/attempts`): the new answer records the edge's term ids at
  their current versions.

`Element` gains `lexicon?: Array<{ id: string; v: number; via?: "detected" | "chip" }>` (question
edges and answers; `via` only on edges sent since auto-detect).

App settings (`GET/PUT /api/settings/app`, feature 11) gain `lexicon_autodetect: boolean`
(default `true`, no environment variable). Stored in `setting_changes`; migration
`0014_lexicon_autodetect` adds the key to the CHECK and requires a boolean value.

Method functions are reachable through the existing routes: `GET /api/nodes/:id/functions` lists
`premortem`, `steelman`, `scqa` for answers; `POST /api/nodes/:id/functions/:fn/run` runs them.
