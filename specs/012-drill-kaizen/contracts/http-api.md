# HTTP API: Drill Kaizen

These follow the v0.2 conventions (`specs/010-v02-message-graph-canvas/contracts/http-api.md`):

- App Router handlers wrapped by `withApi`, with zod shapes in `src/shared/schemas.ts` under a
  `drill` section.
- Errors use `{ error: { code, message, details? } }` with status 400, 404, 409 or 503.
- There is no DELETE or PATCH route. Every change is a POST that inserts a row.
- Every AI-backed POST calls the AI first and writes afterwards, so a 503 leaves nothing behind
  (FR-052 pattern). The one exception is an attempt, which is stored before it is judged
  (data-model.md).

## Shapes

```ts
type Verdict = "solved" | "partly_solved" | "not_solved";
type Result = Verdict | "unattempted";
type RungState = "locked" | "open" | "solid";

type Rung = {
  id: string; name: string; provenance: Provenance; removed: boolean;
  state: RungState; level: number;
  history: Array<{ roundNumber: number | null; level: number; state: RungState; cause: string; changeId: string }>;
};

type DrillSummary = {                       // canvas card (FR-024)
  drillId: string; nodeId: string; domain: string; complete: boolean;
  newestOpen: { rungId: string; name: string; level: number } | null;
  parentDrill: { drillId: string; domain: string } | null;
};

type DrillProblem = {
  element: Element;                         // kind drill_problem (text, provenance)
  rungIds: string[]; level: number; position: number;
  result: Result; flagged: boolean; skipped: boolean;
  hint: Element | null;                     // only once a hint event exists
  solution: Element | null;                 // only once revealed
  attempts: Array<{
    attempt: Element;                       // kind drill_attempt
    verdict: (Element & { verdict: Verdict; hinted: boolean }) | null;
    override: { verdict: Verdict; at: string } | null;
  }>;
  followUps: Array<{ edgeId: string; text: string | null; createdAt: string }>;
};

type DrillRound = {
  roundId: string; number: number; ended: null | { by: "all_answered" | "user"; at: string };
  lessons: Element[];                       // drill_lesson, with properties.rungId
  problems: DrillProblem[];
  note: Array<{ rungId: string; from: number; to: number; fromState: RungState; toState: RungState; evidence: string[]; cause: string }>;
  currentProblemId: string | null;          // research R11
};

type Drill = DrillSummary & {
  projectId: string; started: boolean;
  ladder: { versionId: string; provenance: Provenance; rungs: Rung[] };
  settings: { round_size: string; open_level: string; solid_level: string };
  rounds: DrillRound[];                     // oldest first
  attachments: Array<{ nodeId: string; excerpt: string; attachedAt: string }>;
  offer: null | { offerId: string; candidates: Array<{ nodeId: string; domain: string; excerpt: string }>; dismissed: boolean };
};
```

## Routes

| Method and path | Body | Response | Notes |
|-----------------|------|----------|-------|
| GET `/api/drills?projectId=` | | `{ drills: DrillSummary[] }` | For the canvas card (C3). |
| POST `/api/drills` | `{ projectId, domain, sourceNodeId?, offerId? }` | `{ drill: Drill }` | Calls `drill_ladder`, then inserts the drill, `drill_start` edge, drill node and ladder version 1 in one transaction. Given `sourceNodeId` and `offerId`, it records `picked` and links the parent (FR-033). 503 `ai_unavailable` writes nothing. |
| GET `/api/drills/:drillId` | | `{ drill: Drill }` | 404 if the drill or its project is trashed. |
| POST `/api/drills/:drillId/ladder` | `{ rungs: [{ id?, name, removed? }] }` | `{ drill }` | A new ladder version. New rungs get ids. On a started drill, new rungs get a `start` change as `locked`. 409 `ladder_order_locked` if open or solid rungs are reordered. |
| POST `/api/drills/:drillId/start` | | `{ drill }` | Writes the confirmed ladder copy if needed, `start` changes (rung 1 open at level 1, others locked) and `started_at`, then generates round 1 with its lesson. 409 `already_started`, 409 `empty_ladder`. |
| POST `/api/drills/:drillId/rounds` | | `{ drill }` | Generates the next round when no round is open. It is used automatically after a round ends, and as the retry after a 503. 409 `round_open`. |
| POST `/api/drill-rounds/:roundId/end` | | `{ drill, nextRoundError?: ApiError }` | Records the end, writes `auto` level changes (R7), runs the offer if the drill became complete, then generates the next round. If generation fails, the end and changes stay and `nextRoundError` is returned for the retry button. Called automatically by the client once every problem has a result (`all_answered`), or by the user. |
| POST `/api/drill-problems/:problemId/attempts` | `{ text }` | `{ problem: DrillProblem, roundEnded?: boolean }` | Inserts the attempt, then calls `drill_verdict` and inserts the verdict. If the verdict fails, the attempt stays and 503 `verdict_unavailable` carries `{ attemptId }`. |
| POST `/api/drill-attempts/:attemptId/judge` | | `{ problem }` | Retries a missing verdict. 409 `already_judged`. |
| POST `/api/drill-verdicts/:verdictId/override` | `{ verdict }` | `{ drill }` | When the round has ended, it writes `recompute` changes that supersede that round's `auto` changes (FR-021). Later rounds are untouched. |
| POST `/api/drill-problems/:problemId/events` | `{ type: "hint" \| "reveal" \| "skip" \| "flag", reason? }` | `{ problem }` | No AI call (R9). `flag` excludes the problem from progression. |
| POST `/api/drill-problems/:problemId/replace` | | `{ round }` | Only for flagged problems. Calls `drill_round` for one problem with the same rungs and level, inserts it under the same round edge with `replaces`, and records `replaced`. |
| POST `/api/drills/:drillId/rungs/:rungId/level` | `{ level?, state? }` | `{ drill }` | A `manual` change (FR-021). |
| POST `/api/drills/:drillId/attachments` | `{ nodeId, action: "attach" \| "detach" }` | `{ drill }` | No AI call (FR-027). 409 `wrong_project`. |
| POST `/api/drill-offers/:offerId/dismiss` | | `{ drill }` | |
| POST `/api/kind-settings` (existing) | `{ kind: "drill", nodeId: drillNodeId, key, value }` | as v0.2 | Per-drill override (C6). |

Follow-ups and branches use the existing v0.2 routes with a drill element as the source:

- `POST /api/nodes/:verdictOrProblemId/ask` for a follow-up
- `POST /api/nodes/:id/branches` for highlight → Branch
- the parked and definitions routes for Park and Define

Nothing drill-specific is added, because the elements are ordinary `nodes` (research R1 and R3).

## As built (2026-10-07)

Where the implementation differs from the tables above:

- Validation errors are **422** `invalid_request` (v0.2's `withApi`), not 400.
- A failed AI call on create, start or round generation is **503 `function_unavailable`** (v0.2's
  "nothing was created" error), not `ai_unavailable`. Start and round end keep what they wrote and
  return `nextRoundError: { code, message }` in a 200 instead of failing.
- Every action returns `{ drill }`, the whole drill as it now is (`DrillStepResponse`). Attempts and
  judge also return `roundEnded`, and the client then ends the round with `{ by: "all_answered" }`.
  The end route takes a body `{ by: "all_answered" | "user" }`.
- A verdict failure is **503 `verdict_unavailable`** with `attemptId` at the top level of the body.
- Per-drill settings use the existing **PUT** `/api/kind-settings` with `nodeId` (C6). The kind's
  `validateSettings` refuses `open_level >= solid_level` with 422.
- More 409 codes: `not_started`, `round_ended`, `not_all_answered`, `no_open_rung`, `problem_flagged`,
  `already_flagged`, `not_flagged`, `already_replaced`, `not_offered`.
- `DrillSummary.newestOpen` has `number`. `Drill` also has `domainProvenance`, `startEdgeId` and
  `sourceNodeId`. `DrillRound` has `shortNote`, and its lessons carry `rungId`. `DrillProblem` has
  `roundId` and `replaces`. `offer` has `picked`.
- `followUps` also lists branches made from the problem's attempts.
