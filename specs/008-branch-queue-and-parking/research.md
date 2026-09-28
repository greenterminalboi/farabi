# Research: Branch Queue (Parked Tangents & Branches Panel)

No Technical Context item was left as NEEDS CLARIFICATION: the stack is unchanged. The decisions
below settle how the spec fits the existing code and its constitution guards.

## R1. How parked tangents are stored, edited and discarded

- **Decision**: two tables.
  - `parked_tangents` holds the anchor. Its rows are never updated or deleted.
  - `parked_tangent_events` is an append-only log with three event kinds: `question_set` (text or
    null), `discarded` and `fired` (with the new child node).
  - An item's current question is its latest `question_set` event. An item is live while it has
    no `discarded` or `fired` event.
  - All three actions (edit, discard, fire) are POST routes.
- **Rationale**:
  - `tests/integration/constitution.test.ts` forbids DELETE and PATCH handlers anywhere in the
    API. Every history table (feedback state, settings, definition and edge-label versions) is
    append-only, with a trigger enforcing it.
  - Article VI names "what was abandoned" as first-class history. A discarded tangent is exactly
    that.
  - The spec only needs a discarded item to leave the Parked tab and never produce a branch
    (FR-015, US4-3). It does not require the data to be destroyed.
- **Alternatives considered**:
  - A mutable row with `question` and `discarded_at` columns needs UPDATE, which breaks the
    append-only pattern. The history of edits would also be lost.
  - Hard DELETE would need the first DELETE route, and the Article II guard test would fail. It
    would also erase the abandonment signal Article VI protects.

## R2. Firing a parked item: atomic and at most once

- **Decision**: `POST /api/parked/{id}/fire` does all of its writes in one transaction:
  1. Lock the tangent row with `SELECT … FOR UPDATE`. The trigger blocks UPDATE, not row locks.
  2. Reject the request if the item has already been fired or discarded.
  3. Insert the node and a `selection` branch marker.
  4. If there is a question, insert the user message and the pending AI reply.
  5. Append the `fired` event.

  Generation starts only after commit, as `sendOrdinary` does today.

  A unique partial index allows only one `fired` or `discarded` event per tangent, so a double
  click or a race cannot create a second branch (FR-014).
- **Refactor**:
  - `createBranch`'s body splits into `validateAnchor(trx, nodeId, anchor)` and
    `insertBranch(trx, parent, message, anchor)`. `sendOrdinary`'s inserts become
    `insertUserTurn(trx, nodeId, content)`.
  - Branch, Park and fire all reuse these helpers, so a fired branch matches a normal Branch on
    the same span exactly (FR-013a).
  - The Article IV guard ("no AI module creates nodes") still holds: `src/server/parked/` is not
    under `src/server/ai`.
- **Rationale**: `tryQuickBranch` commits the branch and then calls `sendMessage` separately.
  For a parked item, a failure between those two steps would consume the item and lose the
  user's typed question. The spec's reload edge case requires "either still parked or fully
  consumed", so one transaction is needed.
- **AI service unreachable** (US2-4): generation fails after commit exactly as an ordinary send
  does. The reply becomes `failed`, and ChatView's existing "AI service unavailable … Use Retry"
  path applies unchanged.

## R3. Where the panel's data comes from

- **Decision**: `NodeView` (`GET /api/nodes/{id}`) gains two fields:
  - `children: MapNode[]`: direct children, newest first.
  - `parked: ParkedTangent[]`: live items, newest first.
- **Rationale**:
  - ChatView already reloads `NodeView` when the node changes, after every action, and on its
    4-second summary poll. FR-004 (tabs follow the open node) and FR-014 (a fired item leaves
    Parked and appears under Branches) therefore come for free.
  - The node cache (`src/lib/nodeCache.ts`) shows the tabs instantly when the user comes back to
    a node.
  - The cost is two indexed queries per node load.
- **Alternatives considered**: separate `GET …/children` and `GET …/parked` endpoints would mean
  extra round trips and a second polling loop, with nothing gained at single-user scale.

## R4. Preloading the composer (FR-009, FR-010, FR-013)

- **Decision**: before `router.push`, the client calls `useViewStore.getState().setDraft(childId,
  text)`. The text is the typed question, or the anchor text when the question is blank.
  - For Branch, the client already has both strings.
  - For a question-less fire, the fire response returns `draft: anchorText`.
- **Rationale**:
  - The composer already reads its draft from `viewStore.byNode[nodeId].draft`. Seeding that
    entry is the whole mechanism, and no server state is needed.
  - The draft is unsent text, like any composer draft today. The anchor text can always be
    recovered from the branch's quoted context, so losing it on a hard reload loses nothing.

## R5. The inline question field (FR-008, SC-006)

- **Decision**: clicking Branch or Park turns the toolbar into a compact form:
  - a single-line input with the placeholder "Your question (optional)", focused automatically
  - a confirm button labelled with the action ("Branch" or "Park")
  - Enter confirms and Esc cancels (US1-6)

  While the form is open, the captured anchor is frozen, so focusing the input doesn't end the
  pending selection through `selectionchange`.
- **Interaction count**: Branch and Park each take click, then Enter (or a second click). Parking
  therefore never costs more than branching (SC-006). Park keeps the user in the conversation. It
  shows a toast "Parked · View", which opens the Parked tab, and then clears the selection.
- **Existing tests**: `tests/e2e/helpers.ts` `branchOn`, `us2-branch.spec.ts` and
  `f5-suggestions.spec.ts` click Branch once. They gain a confirm step.
- **Alternatives considered**:
  - Showing the field only on Park conflicts with FR-008.
  - A modal dialog is heavier than "a small field that appears right there" (US1).

## R6. Regenerating a reply that has live parked items

- **Decision**: a reply with a live parked item is treated like a reply with branches.
  - `canRegenerate` is false, and `regenerate.ts` refuses with 409 `has_parked`, which reads
    "This reply has parked tangents, so it can't be regenerated".
  - Discarding or firing the item lifts the block (firing turns it into a real branch, which
    blocks regeneration anyway).
- **Rationale**:
  - Regeneration marks the old reply `replaced_at`, and `validateAnchor` refuses replaced
    messages. Without this block, a parked item could point at a hidden message and could
    neither fire nor show its source.
  - Letting regeneration silently discard the item would be an automatic side effect, which
    FR-017 and Article II rule out.
- **Scope note**: this rule is not in the spec. It is the smallest behavior that satisfies
  FR-017. If you'd rather regenerate take priority, the alternative is to mark such items
  "source replaced" and allow only discard.

## R7. Panel layout

- **Decision**:
  - `ChatView` returns the chat `<section>` and a new `<BranchPanel>` side by side, as siblings in
    the existing `.main` flex row. There is no extra wrapper, so the chat JSX doesn't need
    re-indenting.
  - The panel is 300px wide, or 260px below 1100px of viewport width. The chat column (820px max)
    narrows beside it and stays centered in the space that's left.
  - Only below 640px does the open panel overlay the chat from the right, as the feedback drawer
    does.
  - The panel can be collapsed to a slim strip with a toggle in its header. Whether it's open is
    stored per browser in `settingsStore` (persisted, like `showSuggestions`). The default is open.
  - The feedback drawer (z-index 20) still opens on top of the panel.
- **Tabs**:
  - Tab controls use `role="tablist"` and `role="tab"`. Each label shows its count, for example
    "Parked 3".
  - An empty tab shows its own sentence (FR-005):
    - Branches: "No branches from this conversation yet. Select text and choose Branch."
    - Parked: "Nothing parked. Select text and choose Park to save a tangent for later."
- **Rationale**:
  - FR-001 asks for a right-side panel. The spec leaves collapse and default state to design.
  - Implementation first overlaid the panel below 1100px. Because the panel is open by default,
    that covered the composer on ordinary laptop widths, so the chat narrows instead.

## R8. Inherited context of a fired branch (FR-013a)

- **Decision**: no change. A fired branch gets a `selection` marker, so `getInheritedContext`
  already includes the anchored message in full. Only `whole_message` markers (quick branch) cut
  one message earlier.

## R9. Keeping parked content away from the AI and the map

- **Decision**:
  - Nothing reads `parked_*` except `src/server/parked/`, the node view assembler, the regenerate
    guard, the schema and migrations.
  - Parked questions reach the AI only once fired, as the first message of the new branch.
  - Map and forest queries don't read parked items (map view is out of scope).
- **Enforced by**: new constitution guard tests (see [data-model.md](./data-model.md)).

## R10. Ordering

- **Decision**: both tabs are newest first:
  - Branches by `nodes.created_at DESC, id DESC`.
  - Parked by `parked_tangents.created_at DESC, id DESC`.

  An edit doesn't move an item.
