# Declarations: Kinds, Functions, Readers, Runner

This carries over Feature 9's
[declarations contract](../../009-node-function-foundation/contracts/declarations.md). Only the
differences are listed. FR-043 to FR-054, SC-013.

## Kind declaration (`src/shared/kinds/types.ts`)

```ts
type NodeKindDeclaration = {
  id: string;
  label: string;
  /** Content (node) or act (edge) (FR-001, FR-043). Copied into nodes.shape on insert. */
  shape: "node" | "edge";
  /** How the canvas draws it (contracts/canvas-ui.md). New kinds reuse one. */
  display: "answer" | "question" | "function_connector" | "output";
  settings: SettingDeclaration[];          // unchanged from Feature 9
  properties: z.ZodType<Record<string, unknown>>;  // unchanged; undeclared keys rejected (FR-054)
  /** For function outputs: which kinds may be the input of the function that makes it. */
  acceptsInputKinds?: string[];
};
```

Removed from Feature 9: `conversationBacked`, `view` and `mapLabel`.

The registry checks each declaration, and an invalid one fails at registration:

- unique ids
- unique setting keys
- defaults that are among the choices
- `display` consistent with `shape`: `answer` and `output` are nodes, `question` and
  `function_connector` are edges

## Function definition (`src/server/functions/definitions/types.ts`)

```ts
type FunctionDefinition = {
  id: string; version: number; name: string;
  accepts: string[];             // input kinds (shape node only in v0.2)
  reads: "text";                 // the input node's own immutable text
  outputKind: string;            // a registered kind with shape "node" whose acceptsInputKinds ⊇ accepts
  edgeKind: "function";          // the act it is recorded as
  procedure: "propose";          // outputs are ai_suggested and wait for review
  instruction: { system(settings): string; prompt(source: { text: string }, settings): string };
  parse(raw: string): string;    // throws AIUnavailableError when unusable
};
```

## Runner (`src/server/functions/runner.ts`)

```text
runFunction(functionId, inputId)
  load input (live project), check kind ∈ accepts                 → 409 wrong_kind
  settings ← resolve(outputKind, override = none)
  text     ← provider.complete(instruction(read(input), settings)) → 503, nothing written (FR-052)
  in one transaction: insert function edge (parent = input), output (parent = edge)
  return { edge, output }

rerunFunction(edgeId)
  load function edge, its definition by function_id (current version), its input (parent)
  settings ← resolve(outputKind, override = edgeId)
  text     ← provider.complete(...)                                → 503, nothing written
  insert output (parent = edge)
```

The runner never mentions a specific function or kind. SC-013 is checked by
`tests/unit/f10-registries.test.ts` and `tests/integration/f10-functions.test.ts`:

1. From inside the test file, register a test kind `summary_card` (shape node, display output)
   and a test function `restate` that accepts `answer` and outputs `summary_card`.
2. Run it through the HTTP route.
3. Assert that a function edge and output appear.

The test only touches the registries and the route, never the runner, so "zero changes to the
runner" holds by construction. A guard also checks that `runner.ts` contains no function or kind
id literal.

## Analogy v2 (`src/server/functions/definitions/analogy.ts`)

- `version: 2`, `accepts: ["answer"]`, `reads: "text"`.
- The instruction is the Feature 9 one with "summary" replaced by "the text below, an AI answer
  from the person's own conversation".
- The no-new-claims rule is unchanged (Article III).
- Settings are unchanged: `reach` and `length`.
