# Declarations: Drill Kinds and Operations

This extends `specs/010-v02-message-graph-canvas/contracts/declarations.md`. The registry-shape
changes (C1, C6 in research R15) are logged in farabi-coord/STATUS.md before they are made.

## Registry additions (C1)

```ts
type Display = "answer" | "question" | "function_connector" | "output" | "drill";  // drill → node

type NodeKindDeclaration = {
  // …unchanged v0.2 fields…
  /** false: stored and selectable on its own screen, never drawn on the canvas. Default true. */
  onCanvas?: boolean;
  /** How the element appears in a reply's ancestor-path context. Absent: skipped. */
  contextRole?: "user" | "ai";
};
```

- The existing kinds gain `question.contextRole = "user"` and `answer.contextRole = "ai"`. The
  context builder still includes an answer only when its status is `complete`.
- No other behavior changes.

## Drill kinds (`src/shared/kinds/drill/*.ts`)

Each is a declaration registered in `src/shared/kinds/index.ts`. Shapes, displays, roles and
properties are listed in [data-model.md](../data-model.md). The `drill` kind declares these
settings:

| key | label | choices | default |
|-----|-------|---------|---------|
| `round_size` | Problems per round | 1–10 | 4 |
| `open_level` | Open the next rung at level | 2–9 | 4 |
| `solid_level` | Mark a rung solid at level | 3–10 | 7 |

## Operations (`src/server/drill/operations/*.ts`)

```ts
type DrillOperation<In, Out> = {
  id: string;                       // recorded as function_id on everything it produces
  version: number;
  effort: "low" | "medium";
  maxTokens: number;
  instruction: { system: string; prompt: (input: In) => string };
  output: z.ZodType<Out>;           // validated after JSON extraction (research R5)
};

callOperation(op, input, { model }) → Out    // one retry with the validation error, then AIUnavailableError
```

`callOperation` never mentions an operation id. A guard test checks this, mirroring v0.2's runner
guard.

| id | Reads | Returns |
|----|-------|---------|
| `drill_ladder` | domain, attached conversations | `{ rungs: string[] (1–12, basic → advanced), note?: string }` |
| `drill_round` | domain, ladder, round plan (rung → count, level), level descriptors, earlier problems, recent mistakes with feedback, attached conversations, rungs needing a lesson | `{ lessons: [{ rungId, text }], problems: [{ rungIds, level, text, hint, solution }] }` |
| `drill_verdict` | domain, rung names, problem, reference solution, attempt, whether hinted | `{ verdict, feedback }` |
| `drill_offer` | finished drill's domain and ladder, candidate nodes' text (each cut to 1,500 characters) | `{ picks: [{ nodeId, domain }] (0–3, nodeIds must be candidates) }` |
| `drill_domain` | one node's root-to-node path | `{ domain }`. Not used in this plan (the offer writes domains). Reserved for "drill from any node" later. |

## Instruction rules (Constitution Article III)

- Lessons and problems are practice material. They never claim anything about the user's own map
  or thinking.
- When attached conversations are given, problems may reuse their examples and must say so in
  `readAttachments`.
- Problems must address the plan's rungs and levels exactly. Levels are described per rung
  (FR-008): 1–2 a single direct step with cues, 3–4 a few steps or a common edge case, 5–6 fewer
  cues or an unfamiliar framing, combining with another rung allowed, 7–8 multi-step with traps,
  9–10 open-ended design or explanation.
- Verdict feedback must refer to the attempt's own content and must not reveal the full solution.
