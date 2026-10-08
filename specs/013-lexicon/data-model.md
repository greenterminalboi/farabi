# Data Model: Farabi Lexicon

## Term (repo data, `src/shared/lexicon/data/<slot>.json`)

| Field | Type | Rules |
|-------|------|-------|
| id | string | `^[a-z0-9]+(-[a-z0-9]+)*$`, unique across all slots, never reused |
| name | string | Display name, e.g. "Distill" |
| aliases | string[] | Other surface forms ("Elaborate", "distilled"); unique across names and aliases (case-insensitive) |
| slot | `operation \| scope \| format \| tone \| audience \| strength \| quality` | Must match the file it lives in |
| meaning | string | One line, from the dictionary's "What it asks for" column |
| example | string | From the dictionary's example column |
| neighbours | string[] | Ids of existing terms, usually same slot; not itself |
| conflicts | string[] | Ids of existing terms; symmetric (A lists B ⇔ B lists A) |
| version | int ≥ 1 | Increases whenever `instruction` changes (lock enforced) |
| instruction | string | Exact text sent; ≤ 400 chars; no `<` or `>`; calm wording, a reason, an output check where one applies |
| effect | string | The observable effect a test or reader can check |
| check | string? | Id of a code check in `checks.ts` (e.g. `bulleted`, `numbered`, `table`) |
| retired | boolean? | Retired terms can't be added; still resolvable for history |

Derived: `role` = `operation` for the operation slot, otherwise `modifier`.
Single-value slots: operation, scope, format, tone, audience. Multi-value: strength, quality.

## Version lock (`src/shared/lexicon/data/versions.lock.json`)

`{ "<id>": { "v": <version>, "sha": "<sha256 of instruction, first 16 hex>" } }`. A test fails when
an instruction's hash differs from the lock at the same version; `npm run lexicon:lock` rewrites the
lock and refuses entries whose hash changed without a version increase.

## Term use (stored in `nodes.properties.lexicon`)

`Array<{ id: string; v: number }>`, at most 6, no duplicate ids. Declared (strict Zod) on the
`question` and `answer` kinds; absent when empty.

- Question edge: set at insert (new tree, ask, quick-branch copy) or at send of an unsent edge
  (migration 0013). Records what the user asked for.
- Answer: set at insert by `insertPendingAnswer` from its edge's uses, with each term's current
  version. Records what the reply was sent.

## Element (API)

`Element.lexicon?: Array<{ id; v }>` on question edges and answers, copied from properties.

## Method output kinds

| Kind / function id | Name | Display | Accepts | Settings |
|--------------------|------|---------|---------|----------|
| premortem | Premortem | output | answer | none |
| steelman | Steelman | output | answer | none |
| scqa | SCQA | output | answer | none |

Function edges and outputs follow Feature 010 (function_id, function_version, review history).

## nodes_guard change (migration 0013)

Unchanged except: `properties` may differ from OLD only in the send transition (OLD is an unsent
question edge with `properties = '{}'`, NEW sets text and sent_at). Forward-only, like every migration here.
