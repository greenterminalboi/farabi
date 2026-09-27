# Contract: AI Provider Boundary

Internal TypeScript interface in `src/server/ai/`. Everything outside `src/server/ai/` depends
only on this interface. The real Claude implementation, SDK and transport are **deferred**
(research R10). v1 development and all automated tests use `FakeAIProvider`.

```ts
interface ChatTurn { role: "user" | "ai"; content: string }

interface ReplyInput {
  /** Ancestor messages up to each branch point, oldest first (FR-005). Empty for roots. */
  inheritedContext: ChatTurn[];
  /** The exact anchor text for a branch; null for roots (FR-004). */
  anchorText: string | null;
  /** This node's own non-replaced messages, ending with the latest user message. */
  messages: ChatTurn[];
  signal?: AbortSignal;
}

interface SummaryInput {
  /** Anchor text for a branch; null for roots. */
  anchorText: string | null;
  /** This node's own non-replaced messages only — NEVER inherited context (FR-012). */
  messages: ChatTurn[];
  signal?: AbortSignal;
}

interface AIProvider {
  /** Resolves to the full reply text. Throws AIUnavailableError when the service can't be reached. */
  reply(input: ReplyInput): Promise<string>;
  /** Resolves to exactly one sentence. Throws AIUnavailableError on failure. */
  summarize(input: SummaryInput): Promise<string>;
}

class AIUnavailableError extends Error {}
```

## Rules

- `summarize` input is built by one function that takes a node id and can only read that
  node's messages and anchor, so FR-012's "no inherited context" is enforced structurally.
- The provider never creates nodes, branches or markers (Article IV; spec out-of-scope).
- The API key (when the real provider exists) is read only inside `src/server/ai/` from the
  server's environment (`.env.local`); it never appears in any HTTP response (research R10).

## FakeAIProvider (development and tests)

- `reply`: returns a deterministic text derived from the last user message (e.g.
  `"Echo: <text>. Containers are mentioned here."`), so tests can select known phrases.
- `summarize`: returns `"About: <last 6 words of the last message>."`, so drift (Story 5) is
  observable.
- Can be switched to fail (`AIUnavailableError`) or delay, to test FR-013 and FR-032.
