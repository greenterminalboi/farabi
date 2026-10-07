# Data Model: Drill Kaizen

Migration `src/server/db/migrations/0011_drill.ts`. It builds on v0.2's `nodes`, `trees` and
`kind_setting_changes` (`specs/010-v02-message-graph-canvas/data-model.md`). Decisions are in
[research.md](./research.md) (R1, R2, R7, R10–R12).

## Overview

```text
projects ─< drills ─┬─ node_id ─────▶ nodes (kind drill)          the drill tree, see research R2
                    ├─< drill_ladder_versions                     append-only snapshots
                    ├─< drill_level_changes                       append-only; evidence → nodes
                    ├─< drill_attachments                         append-only attach/detach → nodes
                    └─< drill_offers ─< drill_offer_events
nodes (drill_round edge) ─ drill_round_ends                       one row per ended round
nodes (drill_problem)    ─< drill_problem_events                  hint / reveal / flag / skip / replaced
nodes (drill_verdict)    ─< drill_verdict_overrides
```

Every table here is append-only, enforced by a `BEFORE UPDATE OR DELETE` trigger that raises
(Article II). None has a DELETE or PATCH route.

## Change to an existing table

- `nodes.origin` CHECK: add `'drill'`. It is used by the drill node and by a `drill_start` edge that
  has a parent (R2). This is additive and logged as a contract change.

## Element kinds in `nodes` (declarations, no tables)

| Kind | Shape | Display | onCanvas | contextRole | Provenance | Text | Declared properties |
|------|-------|---------|----------|-------------|------------|------|---------------------|
| `drill_start` | edge | question | yes | user | user_authored | the domain | — |
| `drill` | node | drill | yes | — | user_authored | `''` | — (settings: `round_size`, `open_level`, `solid_level`) |
| `drill_round` | edge | function_connector | no | — | ai_suggested | null | `number`, `plan` (rung → count, level), `note` |
| `drill_lesson` | node | output | no | ai | ai_suggested | lesson markdown | `rungId`, `readAttachments` |
| `drill_problem` | node | output | no | ai | ai_suggested | problem markdown | `rungIds` (1–2), `level`, `position`, `informedBy` (attempt ids), `readAttachments`, `replaces` (problem id, optional) |
| `drill_hint` | node | output | no | — | ai_suggested | one line | `problemId` |
| `drill_solution` | node | output | no | — | ai_suggested | worked solution | `problemId` |
| `drill_attempt` | edge | question | no | user | user_authored | the attempt | — |
| `drill_verdict` | node | output | no | ai | ai_suggested | feedback markdown | `verdict` (`solved`, `partly_solved`, `not_solved`), `hinted` |

Rules:

- `drill_round`, its children and `drill_verdict` have origin `run` with `function_id` and
  `function_version` set to the operation that made them (R4).
- A `drill_attempt` has origin `ask`, and its parent is a `drill_problem`.
- An attempt is inserted with its text set and `sent_at` filled in, and is never updated
  (FR-015, `nodes_guard`).
- A verdict is inserted already complete, in one statement, after the AI call (R9). If the call
  fails, the attempt stays and has no verdict, and can be judged again.
- A `drill` node's only parent is a `drill_start` edge. A `drill_start` edge's parent is null
  (origin `origin`) or any content node in the same project (origin `drill`).

## Tables

### `drills`

| Column | Type | Rules |
|--------|------|-------|
| id | uuid PK | |
| project_id | uuid NOT NULL → projects | Equals the drill node's project. |
| node_id | uuid NOT NULL UNIQUE → nodes | The `drill` node. |
| domain | text NOT NULL CHECK length 1..300 | A copy of the `drill_start` edge's text, kept for listing. |
| domain_provenance | provenance NOT NULL | `user_authored`, or `user_confirmed` when an offered domain was accepted unchanged. |
| source_node_id | uuid NULL → nodes | Set when started from a starting point (FR-033). |
| parent_drill_id | uuid NULL → drills | The drill whose offer it came from. |
| started_at | timestamptz NULL | Set once, when round 1 is first requested. This is the only mutable column (NULL → value, enforced by trigger). |
| created_at | timestamptz NOT NULL DEFAULT clock_timestamp() | |

Trash and restore follow the project (FR-029). There is no flag of its own.

### `drill_ladder_versions`

Each edit to the ladder writes the whole ordered list (FR-002).

| Column | Type | Rules |
|--------|------|-------|
| id | uuid PK | |
| drill_id | uuid NOT NULL → drills | |
| rungs | jsonb NOT NULL | `[{ id: uuid, name: text 1..120, provenance, removed: boolean }]`, in ladder order. A rung id stays the same across versions. |
| provenance | provenance NOT NULL | `ai_suggested` for the proposal, `user_authored` for any edit. |
| created_at | timestamptz NOT NULL | |

- The newest version is the ladder.
- A removed rung stays in the list with `removed: true`. Its history is kept and it is hidden
  (edge case).
- The first `user_authored` version, or starting with the proposal unchanged (which writes a
  `user_confirmed` copy), confirms the ladder. Start is refused until the ladder has at least one rung
  that isn't removed.

### `drill_level_changes`

Each rung's level and state over time (FR-005, FR-019–FR-021).

| Column | Type | Rules |
|--------|------|-------|
| id | uuid PK | |
| drill_id | uuid NOT NULL → drills | |
| rung_id | uuid NOT NULL | A rung id from the ladder. |
| round_id | uuid NULL → nodes | The ended `drill_round` edge it was computed from. NULL for `start` and `manual`. |
| from_level, to_level | smallint, CHECK 1..10 | `from_level` is NULL for `start`. |
| from_state, to_state | text CHECK IN ('locked','open','solid') | |
| cause | text NOT NULL CHECK IN ('start','auto','recompute','manual') | |
| provenance | provenance NOT NULL | `ai_suggested` for `start`, `auto` and `recompute`; `user_authored` for `manual`. |
| evidence | uuid[] NOT NULL DEFAULT '{}' | The attempt edge ids behind it (FR-020). Empty for `manual`. |
| supersedes | uuid NULL → drill_level_changes | For `recompute`: the change it replaces in the round note. |
| created_at | timestamptz NOT NULL | |

- A rung's current level and state come from its newest row.
- The drill is complete when every rung that isn't removed is `solid`. This is derived and not
  stored.
- Adding a rung inserts a `start` row with state `locked`, which reopens a complete drill (FR-032).

### `drill_round_ends`

| Column | Type | Rules |
|--------|------|-------|
| round_id | uuid PK → nodes | A `drill_round` edge. |
| ended_by | text NOT NULL CHECK IN ('all_answered','user') | |
| created_at | timestamptz NOT NULL | |

A round is open until it has a row here. At most one round per drill is open (checked in the
service, under a lock on the drill row).

### `drill_problem_events`

| Column | Type | Rules |
|--------|------|-------|
| id | uuid PK | |
| problem_id | uuid NOT NULL → nodes | A `drill_problem`. |
| type | text NOT NULL CHECK IN ('hint','reveal','flag','skip','replaced') | |
| detail | jsonb NOT NULL DEFAULT '{}' | `flag`: `{reason}`. `replaced`: `{byProblemId}`. |
| created_at | timestamptz NOT NULL | |

### `drill_verdict_overrides`

| Column | Type | Rules |
|--------|------|-------|
| id | uuid PK | |
| verdict_id | uuid NOT NULL → nodes | A `drill_verdict`. |
| verdict | text NOT NULL CHECK IN ('solved','partly_solved','not_solved') | |
| provenance | provenance NOT NULL CHECK = 'user_authored' | |
| created_at | timestamptz NOT NULL | |

The newest override wins (FR-017).

### `drill_attachments`

| Column | Type | Rules |
|--------|------|-------|
| id | uuid PK | |
| drill_id | uuid NOT NULL → drills | |
| node_id | uuid NOT NULL → nodes | A node in the same project, checked by trigger. The conversation is its root-to-node path. |
| action | text NOT NULL CHECK IN ('attach','detach') | |
| created_at | timestamptz NOT NULL | |

A node is attached when its newest row is `attach`.

### `drill_offers` and `drill_offer_events`

`drill_offers`:

| Column | Type | Rules |
|--------|------|-------|
| id | uuid PK | |
| drill_id | uuid NOT NULL UNIQUE → drills | Once per drill (FR-032). |
| round_id | uuid NOT NULL → nodes | The round whose end completed the drill. |
| candidates | jsonb NOT NULL | 1–3 items of `[{ nodeId, domain }]`. |
| function_id, function_version | text, integer NOT NULL | `drill_offer`. |
| provenance | provenance NOT NULL CHECK = 'ai_suggested' | |
| created_at | timestamptz NOT NULL | |

`drill_offer_events` has the columns `(id, offer_id, type CHECK IN ('picked','dismissed'), node_id NULL, new_drill_id NULL → drills, created_at)`.
After a `dismissed` event the offer is no longer shown. Each pick is recorded.

## Derived values (computed, never stored)

- **Problem result** (FR-018): the newest override, otherwise the newest verdict, otherwise
  `unattempted`.
  - Any `reveal` event makes it `not_solved`.
  - A `solved` result with a `hint` event before its attempt becomes `partly_solved`.
  - A problem with a `flag` event is excluded.
- **Current problem** (FR-009, R11): the lowest `position` in the open round that has no result,
  no `skip` and no `flag`.
- **Round note** (FR-020): built from that round's level changes. Where a recompute supersedes a
  change, the recompute is shown.
- **Drill card** (FR-024): the domain, the newest open rung and its level, and whether the drill is
  complete.

## State transitions

```text
drill:   created (ladder proposed) ──start──▶ running ──every rung solid──▶ complete ──add rung──▶ running
round:   generated ──all problems have results──▶ ended(all_answered)
                   └─user ends────────────────▶ ended(user)
         ended ──▶ level changes written ──▶ (complete? offer) ──▶ next round generated
                                             (next-round AI failure: changes kept, retry generates)
rung:    locked ──newest open rung reaches open_level──▶ open ──level ≥ solid_level──▶ solid
         level ±1 per round (FR-019); manual set at any time (FR-021)
problem: unattempted ─attempt─▶ judged (verdict) ─override─▶ user verdict
         any ─hint/reveal/flag/skip─▶ event recorded
```

## Validation rules

- **Create** (FR-001): the domain is 1–300 characters after trimming, and the project is live.
  The AI ladder call runs first, so if it fails nothing is created (Story 1 AS4).
- **Ladder edit** (FR-002): 1–20 rungs that aren't removed, names 1–120 characters, and rung ids
  unique. If rounds exist, the order of rungs that are open or solid can't change. Only the order of
  locked rungs can (edge case).
- **Attempt** (FR-015): the problem is in the drill's open round or an earlier round (redo, FR-023
  AS2), the text is 1–20,000 characters, and the problem is not flagged.
- **End round** (FR-022): the round is open. Unattempted problems are recorded as unattempted.
- **Manual level** (FR-021): 1–10, and the state is one of `locked`, `open` or `solid`.
- **Settings** (R10): `open_level` < `solid_level`. Saving never starts a run.
- **Attach** (FR-031): the node is in the same project, and neither the node nor the project is
  trashed.

## As built (2026-10-07)

- Following the coordinator's convention (STATUS 16:15), "newest row" is decided by an identity
  column, never `created_at`: `seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE` on
  `drill_ladder_versions`, `drill_level_changes`, `drill_verdict_overrides` and `drill_attachments`.
  Rounds are ordered by their `number` property and problems by `position`.
- `drill_round_ends.levels_seq` records the newest `drill_level_changes.seq` when the round ended,
  before its own changes. A recompute (FR-021) starts from the levels at that point and applies its
  correction as a difference to the current level, so later rounds keep their effect.
- `drill_level_changes`: a `recompute` may have `supersedes` NULL (the round had held that rung);
  only `recompute` rows may set it. Further CHECKs: `start` ⇔ no `from_level`; `manual` ⇔
  `user_authored` with no evidence; `auto`/`recompute` need `round_id`.
- `drill_offer_events`: `picked` ⇔ `node_id` and `new_drill_id` set.
