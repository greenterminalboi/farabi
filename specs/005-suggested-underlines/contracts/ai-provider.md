# Contract: AI Provider changes

This extends `specs/002-map-definitions-streaming/contracts/ai-provider.md`.

```ts
interface SuggestSpansInput {
  /** The completed AI reply's own text, and nothing else (FR-001, Article III). */
  text: string;
  signal?: AbortSignal;
}

interface AIProvider {
  // …reply, summarize, define unchanged
  /**
   * Up to 3 phrases copied exactly from `text`, each worth exploring on its own. Returns [] when
   * nothing qualifies. Throws AIUnavailableError on failure or unparseable output.
   * The caller validates and locates the phrases (research R2); providers don't return offsets.
   */
  suggestSpans(input: SuggestSpansInput): Promise<string[]>;
}
```

## Prompt (`SUGGEST_SYSTEM` in `claudePrompts.ts`)

- The prompt asks for up to 3 short phrases (2–20 words), each copied character for character from
  the reply. Each phrase should name an idea the reader could explore as its own conversation.
- Phrases must be plain prose. They must not include markdown symbols or cross a line break.
- The prompt prefers fewer phrases: if nothing clearly stands out, the model replies `NONE`
  (Article IV, sparse by default).
- **Output**: one `SPAN: <phrase>` line per phrase, or the single line `NONE`. The reply is wrapped
  as `<reply>…</reply>` with the same escaping as the other prompts.
- **Parser**: `parseSpans(text)` keeps `SPAN:` lines, drops everything else, and treats `NONE` or no
  lines as `[]`. If the output has neither `SPAN:` lines nor `NONE`, it throws
  `AIUnavailableError`.

## Per provider

| Provider | Behavior |
|----------|----------|
| `claude` | `beta.messages.create`, `max_tokens: 1000`, `output_config: { effort: "low" }`, same fallback beta |
| `claude-code` | `runHeadless(SUGGEST_SYSTEM, prompt, { effort: "low" })` |
| `fake` | Deterministic: every sentence of `text` with 2–20 words, except ones starting with `Echo:`. Returns the first 3. It honors `fail` and `slow` modes and records `lastSuggest`. For the standard fake reply `Echo: X. Containers are mentioned here.` it returns `["Containers are mentioned here."]` |
