# Contract: AI Provider changes

Extends `specs/001-branching-chat-map/contracts/ai-provider.md`.

```ts
interface ReplyOptions {
  /** Called with each new piece of text as it is generated. */
  onText?: (delta: string) => void;
}

interface DefineInput {
  term: string;
  /** The message the term was captured from. */
  sourceMessage: ChatTurn;
  /** The source node's own messages (never inherited context). */
  messages: ChatTurn[];
  signal?: AbortSignal;
}

interface Definition { general: string; usage: string }

interface AIProvider {
  reply(input: ReplyInput, options?: ReplyOptions): Promise<string>;   // resolves to the full text
  summarize(input: SummaryInput): Promise<string>;
  define(input: DefineInput): Promise<Definition>;
}

/** Thrown when generation stops after some text was produced; carries that text. */
class AIPartialReplyError extends AIUnavailableError { constructor(readonly partial: string) }
```

## Rules

- `reply` rejects with `AIPartialReplyError` when it fails after `onText` has delivered text, and
  with plain `AIUnavailableError` when it fails before any text. An abort (Stop) rejects with an
  `AbortError`; the caller already holds the text delivered so far.
- `define` returns two short parts (research R8). The general part is presented as general
  knowledge; the usage part is grounded in `sourceMessage` and `messages` (FR-029, Article III).
- The provider still never creates nodes, markers, labels or definitions (Article IV).

## Fake provider additions

- `reply` delivers its text in 5 chunks, 40 ms apart.
- Mode `stall`: delivers 2 chunks, then rejects with `AIPartialReplyError`.
- `define` returns `{ general: "General meaning of <term>.", usage: "Here, <term> refers to what the conversation discussed." }`.
