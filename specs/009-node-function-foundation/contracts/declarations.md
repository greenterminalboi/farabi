# Contract: kind and function declarations, readers, provider

These are the internal extension points that FR-002, FR-007, FR-008 and SC-006–SC-007 rely on.
Adding a kind or a function means adding one file and one line in the matching `index.ts`.
Nothing else changes: not the runner, the map, the settings page or the providers.

## Node kind (`src/shared/kinds/`, client-safe)

```ts
type SettingDeclaration = {
  key: string;
  label: string;
  help: string;
  type: "choice";
  choices: Array<{ value: string; label: string }>;
  default: string;                        // must be one of choices
};

type ViewId = "chat" | "output_beside_input" | "pipe";

type NodeKindDeclaration = {
  id: string;                             // stored in nodes.kind
  label: string;                          // "Analogy"; shown in the map tag "AI · Analogy"
  conversationBacked: boolean;            // false → no messages; no Branch/Define/Park (FR-005)
  view: ViewId;                           // what opening the node shows (FR-004)
  mapLabel: "summary" | "output_text" | "none";   // FR-006
  settings: SettingDeclaration[];         // FR-029; [] = no Settings section
  acceptsInputKinds?: string[];           // kinds produced by a function
  properties: z.ZodObject;                // strict; undeclared keys rejected (FR-035)
};

export const KINDS: NodeKindDeclaration[];               // conversation, analogy, pipe
export function getKind(id: string): NodeKindDeclaration;   // throws for unknown ids
export function registerKind(decl: NodeKindDeclaration): void;  // tests and future kinds
```

The registry validates each declaration at registration:

- unique id
- defaults inside their choices
- unique setting keys

## Function (`src/server/functions/definitions/`, server-only)

```ts
type SourcePart = "summary" | "conversation" | "anchor";

type FunctionDefinition = {
  id: string;                             // stored on nodes, pipes
  version: number;                        // bump when the instruction changes
  name: string;                           // menu label
  accepts: string[];                      // input kinds (FR-009)
  reads: SourcePart;                      // FR-007
  outputKind: string;                     // a registered kind with acceptsInputKinds ⊇ accepts
  procedure: "propose";                   // output is ai_suggested and awaits review
  instruction: {
    system: (settings: Record<string, string>) => string;
    prompt: (source: { text: string }, settings: Record<string, string>) => string;
  };
  parse: (text: string) => string;        // cleaned output text; throw AIUnavailableError if unusable
};

export function listFunctionsFor(kind: string): FunctionDefinition[];
export function getFunction(id: string): FunctionDefinition;
export function registerFunction(def: FunctionDefinition): void;   // SC-006 test uses this
```

`settings` passed to `instruction` are the output kind's resolved settings (R7).

## Readers (`src/server/functions/readers.ts`)

```ts
type ReadResult = { ok: true; text: string; version: string } | { ok: false; reason: string };

interface SourceReader {
  read(nodeId: string): Promise<ReadResult>;
  currentVersions(nodeIds: string[]): Promise<Map<string, string>>;   // bulk, for forest staleness
}

export const READERS: Record<SourcePart, SourceReader>;
```

## Runner (`src/server/functions/runner.ts`)

```ts
runFunction(functionId: string, inputNodeId: string): Promise<{ output: MapNode; pipe: MapPipe }>;
regenerateOutput(outputNodeId: string): Promise<{ output: MapNode; version: OutputVersion }>;
```

- The runner is the only module that inserts nodes of a non-conversation kind, and the only
  caller of `provider.complete`. Guard tests check both.
- It looks up everything through the registries and has no `if (id === "analogy")` branch.

## AI provider (`src/server/ai/provider.ts`)

```ts
interface CompletionInput {
  /** Which declaration asked (function id); used by the fake and in logs. */
  tag: string;
  system: string;
  prompt: string;
  signal?: AbortSignal;
}

interface AIProvider {
  // existing: reply, summarize, define
  /** One short, low-effort completion. Throws AIUnavailableError on failure or empty output. */
  complete(input: CompletionInput): Promise<string>;
}
```

Fake behavior: it returns `Fake <tag> #<n>` (`n` counts per process), honors `fail`, `slow` and
`stall` like the other methods, and records `lastComplete` and `completeInputs` in
`getFakeCalls()`.
