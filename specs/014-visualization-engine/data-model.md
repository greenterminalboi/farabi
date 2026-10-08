# Data Model: Farabi Visualization Engine

Nothing is stored. These are in-memory shapes; the exact JSON format is
[contracts/scene-v1.md](./contracts/scene-v1.md).

## Scene (input, validated)

| Field | Type | Rules |
|---|---|---|
| version | `1` | other values refused: "unsupported scene version" |
| title | string | 1–120 chars |
| description | string | 1–1000 chars; the scene's text alternative |
| family | `code` \| `algorithm` \| `argument` \| `general` | |
| origin | `user-authored` \| `ai-suggested` | generation always sets `ai-suggested` |
| width, height | int | 200–2000 / 120–2000; default 800 × 450 |
| elements | Element[] | 1–200, unique ids; connectors reference existing non-connector elements |
| steps | Step[] | 0–100 |

## Element (8 types, discriminated by `type`)

Common: `id` (`^[A-Za-z][A-Za-z0-9_-]{0,39}$`), `x`, `y` (top-left, scene units; not on connector),
`hidden?`, `tone?`.

Parts (addressable by actions through `part`): array cell index, code line (1-based), panel row
key, stack frame index (0 = bottom), graph node id or edge id.

## Step

`caption` (1–300 chars, required), `durationMs?` (0–10000, default 900), `actions` (0–50).

## Frame state (derived)

`FrameState[i]` = the scene's initial state with steps 1..i applied in order. Per element: visible,
position, tone, label/value, and type data (array cells in current order with stable keys,
pointers, current code line and token ranges, panel rows, stack frames, graph node/edge visibility
and tones). Transient marks (compare, swap, changed values) last only for the step that made them.

## Draw item (derived, internal)

`rect`, `text`, `link`, `poly` with a stable `key`, numeric geometry, token paints, opacity.
Frames blend by key (research R4).

## Generation request (HTTP)

`text` (1–20,000 chars), `family?` (`auto` default), `model?` (a known model id or `default`).
Produces a Scene or an error; nothing stored.
