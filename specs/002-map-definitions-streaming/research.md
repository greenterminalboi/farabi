# Research: Map Interactions, Definitions, and Streaming

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-09-27

The stack is unchanged from Feature 1 (`specs/001-branching-chat-map/research.md`). These notes
cover only what this feature adds.

## R1. Streaming transport

- **Decision**: Server-Sent Events (SSE) from a Next.js route handler, consumed in the browser with
  the built-in `EventSource`. No Vercel AI SDK.
- **Rationale**: The user's earlier direction was "Vercel AI SDK over SSE". SSE is kept. The AI SDK
  library is not used because its value is its provider layer and `useChat` hook, and neither fits:
  Farabi's main provider is the Claude Code CLI (no AI SDK provider), and replies are stored and
  replayed from our own database with our own states (pending, incomplete, stopped). Plain SSE is
  ~100 lines and has no dependency.
- **Open point for the user**: confirm dropping the AI SDK library while keeping SSE.
- **Alternatives considered**: AI SDK `streamText` + `useChat` — would need a custom provider for
  the CLI and a custom message store; WebSockets — two-way is not needed; fetch + `ReadableStream`
  NDJSON — works, but `EventSource` gives reconnection for free.

## R2. Generation runs apart from the request (FR-004)

- **Decision**: `POST /api/nodes/{id}/messages` stores the user message and a `pending` AI message,
  starts generation in the background and returns at once. An in-process **generation registry**
  (keyed by message id, kept on `globalThis`) holds the text so far, the subscribers and an
  `AbortController`. `GET /api/messages/{id}/stream` sends a `snapshot` of the text so far, then
  `delta` events, then one `end` event with the final message.
- **Rationale**: Navigating away closes the browser's stream, not the generation, so the reply
  still completes and is stored. Reopening the conversation subscribes again and catches up from
  the snapshot. Feature 1's rule "sent text never changes" holds: `content` is written once, when
  the reply ends (complete, incomplete or stopped).
- **Crash safety**: every ~1 s the text so far is checkpointed to `messages.partial_content`. A
  `pending` message with no live generator (server restarted) is finalised as `incomplete` from
  that checkpoint the next time it is read, so partial text survives (SC-003).
- **Tests**: `?wait=1` on the send endpoint awaits the end, so Feature 1's integration tests keep
  their shape with one query parameter.

## R3. Provider streaming

- **Decision**: extend `AIProvider.reply(input)` with an optional `onText(delta)` callback and an
  `AbortSignal`; the return value is still the full text.
  - **Claude Code CLI**: `--output-format stream-json --verbose --include-partial-messages`; read
    stdout line by line, forward `stream_event` → `content_block_delta` → `text_delta` text, take
    the final `result` event for success or error. Verified on 2026-09-27 with the installed CLI
    (2.1.283). Stop = kill the process.
  - **Claude API**: the SDK stream already used; add a `text` listener. Stop = abort signal.
  - **Fake**: emits the reply in 5 chunks, 40 ms apart, so streaming is testable; a new `stall`
    mode stops mid-reply to test incomplete replies.
- **First-token latency (SC-002)**: unchanged or better; the first delta arrives when the model's
  first text arrives instead of after the whole reply.
- **Note**: the CLI's `rate_limit_event` reports `overageStatus: "allowed"` on this account, which
  suggests extra usage beyond Pro limits may be enabled. That is an account setting, not code.

## R4. Stop and interruption (FR-003, FR-003a)

- **Decision**: `POST /api/messages/{id}/stop` aborts the generator; the message ends `stopped`
  with the text so far. A provider error mid-reply ends it `incomplete`. An error before any text
  keeps Feature 1's `failed`. Retry works on `failed`, `incomplete` and `stopped` alike: the old
  row is kept with `replaced_at`/`replaced_by` (Feature 1 pattern), a new attempt starts.

## R5. Quick branch ("????")

- **Decision**: handled inside the send service, before anything reaches the AI. If the trimmed
  content is exactly `????`, the node has a complete user message, and that message is not already
  a quick-branch anchor → create the child node and a `whole_message` marker (offsets 0..length),
  then send the anchored text as the child's first message (same streaming path). The response is
  `{ kind: "quick_branch", node, ... }` and the client navigates. Otherwise `????` is an ordinary
  message (FR-012, FR-013).
- **Inherited context** for `whole_message` markers is cut *before* the anchored message
  (spec FR-011), because it is the branch's first message.

## R6. Dragging on the map

- **Decision**: **drag the root node to move the whole tree; drag any other node to move just that
  node.** A tree's position is its root's position, so the root is the natural handle, and no mode
  or modifier key is needed.
- **Open point for the user**: confirm "root drags the tree" (alternative: Shift-drag any node).
- **Mechanics**: node containers handle `pointerdown`; after 4 px of movement the viewport's own
  drag is paused (`viewport.plugins.pause('drag')`) and the node or tree follows the pointer in
  world coordinates on every `pointermove`, redrawing only that tree's edges. Under 4 px, release
  is a click (FR-022). The position is saved once, on release — no network traffic during a drag
  (FR-021).
- **Storage**: hand-placed node positions are relative to the tree's origin (FR-017), so moving a
  tree moves them. `layoutTree` computes the tidy layout, then replaces positions of hand-placed
  nodes; the tree's bounding box includes them.
- **Auto-relocation** (Feature 1) skips trees with `user_placed = true`, and user-placed trees act
  as fixed obstacles for trees that are still auto-placed (FR-020).

## R7. Edge labels

- **Decision**: an edge is identified by its child node (every child has exactly one parent).
  Clicking the canvas background runs a hit test: the nearest edge within 8 screen pixels (sampled
  along each bezier) is selected. An HTML text input is placed over the canvas at the edge's
  midpoint for editing. Labels are drawn as `BitmapText` at the midpoint when zoom ≥ 0.5, shortened
  to 40 characters (full text when selected).
- **History**: `edge_label_versions`, append-only; clearing inserts a version with `text = NULL`
  (FR-025, Article VI).

## R8. Definitions

- **Decision**: `definitions` (one row per normalised term) + `definition_versions` (append-only:
  the AI draft, then each confirmation or edit). Normalised key = lower-cased, trimmed, inner
  whitespace collapsed; a unique index on it enforces FR-034.
- **Drafting**: a `define(input)` method on the provider, run in the existing background queue
  (same concurrency cap as summaries). The prompt asks for exactly two labelled parts —
  `GENERAL:` (≤ 2 sentences) and `IN THIS CONVERSATION:` (1 sentence) — parsed on the server.
  Input: the term, the source message, and the source node's own messages (not inherited context).
  Drafts are stored `ai_suggested`; confirm or edit inserts a `user_confirmed` version.
- **Failure**: `definitions.draft_failed_at` is set; the tab shows "Couldn't draft" + Retry.

## R9. Marking collected terms in text (FR-036a–c)

- **Decision**: the client loads a compact index (`GET /api/definitions?index=1`: id, term key,
  term) and builds one regular expression: terms escaped, sorted longest first, joined with `|`,
  wrapped in Unicode-aware word boundaries (`(?<![\p{L}\p{N}])` … `(?![\p{L}\p{N}])`, flag `iu`).
  Longest-first gives "control plane" priority over "plane".
- **Rendering**: the existing rehype plugin that wraps text in offset spans also splits at term
  matches, adding `class="term-mark" data-def-id`. Offsets (`data-start`/`data-end`) stay exact, so
  selection-to-branch still works (FR-036c). The same splitter runs for plain user messages and the
  inherited-context panel.
- **Hover card**: one card component positioned on `pointerover`/`focus` of a `.term-mark`, filled
  from a client cache of full entries (`GET /api/definitions/{id}`), refreshed when the tab or a
  capture changes the entry. Target: card within 300 ms (SC-009a).
- **Scale**: 500 terms → one regex, matched per text node; measured in the scale test.

## R10. Definitions tab (SC-009)

- **Decision**: `/definitions` page, newest first, a filter box, 500 rows rendered plainly (no
  virtual list): 500 short cards are well within 1 s. Revisit if the list grows past a few
  thousand.
