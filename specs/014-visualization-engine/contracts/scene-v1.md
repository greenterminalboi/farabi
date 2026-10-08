# Contract: Scene description, version 1

The single source of truth is `src/viz/schema.ts` (zod). This document mirrors it.

```jsonc
{
  "version": 1,
  "title": "Bubble sort",
  "description": "Sorting [5, 2, 4] by swapping neighbours that are out of order.",
  "family": "algorithm",            // code | algorithm | argument | general
  "origin": "user-authored",        // user-authored | ai-suggested
  "width": 800, "height": 450,      // optional
  "elements": [ /* Element */ ],
  "steps": [ { "caption": "Compare 5 and 2", "durationMs": 900, "actions": [ /* Action */ ] } ]
}
```

## Tones

`default | accent | good | bad | partial | muted | ai`. Highlights also thicken outlines, so tone
is never the only signal (FR-005).

## Elements

All except `connector` have `x`, `y` (top-left). All have `id`, optional `hidden`, optional `tone`.

| type | fields | parts |
|---|---|---|
| `box` | `label`, `w?` (default fits, ≤ 260), `h?`, `shape?` rect \| round \| ellipse, `role?` claim \| premise \| evidence \| conclusion \| note | — |
| `text` | `text`, `size?` sm \| md \| lg, `align?` start \| middle \| end, `w?` (wrap width) | — |
| `connector` | `from`, `to` (element ids), `relation?` plain \| supports \| attacks \| conflicts, `label?`, `directed?` (default true except conflicts) | — |
| `code` | `lines` (1–80 strings), `language?`, `w?`, `title?` | line number, 1-based |
| `array` | `values` (0–40 of string \| number), `label?`, `cellWidth?` (default 48), `pointers?` [{ `name`, `index` \| null }], `showIndices?` (default true) | cell index |
| `panel` | `rows` [{ `key`, `value` }] (0–30), `label?`, `w?` | row key |
| `stack` | `frames` (0–20 strings, bottom first), `label?`, `w?` | frame index, 0 = bottom |
| `graph` | `nodes` [{ `id`, `label`, `x?`, `y?`, `hidden?`, `tone?` }] (1–60), `edges` [{ `id?`, `from`, `to`, `label?`, `relation?`, `directed?`, `hidden?` }] (0–120), `layout?` tree \| layered \| circle \| row \| manual (default layered), `root?`, `w?`, `h?` | node id or edge id (edge id defaults to `from->to`) |

## Actions

| op | fields | applies to | effect |
|---|---|---|---|
| `highlight` | `target`, `part?`, `tone?` (default accent) | any; parts of code/array/panel/stack/graph | persists until cleared |
| `clear` | `target?`, `part?` | any | removes highlights (all elements when no target) |
| `set` | `target`, `part?`, `value` | box (label), text (text), array cell, panel row (added if missing) | value change, marked "changed" for that step |
| `swap` | `target`, `i`, `j` | array | cells exchange places (animated), marked for that step |
| `compare` | `target`, `i`, `j` | array | both cells marked for that step |
| `pointer` | `target`, `name`, `index` (int \| null) | array | moves (or adds, or hides with null) a named pointer |
| `push` | `target`, `label` | stack | new top frame |
| `pop` | `target` | stack | removes top frame (refused when empty) |
| `show` / `hide` | `target`, `part?` | any; graph node/edge, panel row | visibility |
| `move` | `target`, `x`, `y` | any but connector | position |
| `line` | `target`, `line` (int \| null), `tokens?` [{ `start`, `end` }] | code | current execution line and highlighted column ranges on it |

## Validation

`parseScene(json)` returns `{ ok: true, scene }` or `{ ok: false, problems: [{ path, message }] }`.
It checks structure and bounds, unique ids, connector endpoints, then simulates every step: each
target must exist and accept the op, parts must exist at that point in time (cells in range, a row
key present, a frame index below the current stack size, a graph node/edge id), `pop` needs a
non-empty stack. Unknown fields are refused (strict objects), so typos surface.

## Limits

≤ 200 elements (graph nodes count as elements), ≤ 100 steps, ≤ 50 actions per step.
