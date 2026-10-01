# UI Contract: The Canvas

Behaviour the implementation must provide. The test ids and hooks listed here are what the e2e
suite relies on. Decisions are in research R7 to R12.

## Layers (top to bottom)

1. **Screen overlays** (React, screen-space, never scaled): top bar, selection toolbar, composer,
   function menu, term card, marker menu, note editor, side panel, minimap frame, empty state.
2. **Text layer** (`[data-testid=text-layer]`, imperative DOM): one CSS transform equal to the
   camera. Mounted items are `[data-testid=element-text][data-node-id=<id>]`, and each holds text
   runs `span[data-start][data-end]` on the element's raw text.
3. **Drawn layer** (PixiJS canvas `[data-testid=canvas]`): element frames, connectors, tree
   regions, the path emphasis, the focus ring and the minimap. It holds no text.

The text-layer transform is updated in the same frame as the canvas render. The test hook
`__farabiCanvasDrift()` returns the largest pixel difference between a sample of mounted items'
`getBoundingClientRect()` and the drawn frames' screen boxes. It must be ≤ 1 (FR-029).

## Elements as drawn

| Element | Frame | Text |
|---------|-------|------|
| answer | 480-wide card, light fill, AI tag in the frame header. Pending: animated header dots. Incomplete or stopped: a footer with the status and Retry. Failed: a compact error stub with Retry. | Markdown, rendered from `RichText` |
| question edge | 360-wide user bubble (Feature 7 colours) between its parent and its answer, joined by connectors | Plain text. Unsent: an empty dashed bubble that the composer is pinned to. |
| origin edge | Same as question, with a small tree handle for dragging the tree | |
| function edge | A labelled directional connector (`Analogy →`), not a box. Dashed while proposed, solid once confirmed (FR-049). | Its label is a screen overlay chip |
| analogy output | 320-wide AI-tinted card with the AI tag and confirm and reject controls | Plain text |

The path emphasis (FR-026): the focused element's ancestors and the connectors between them are
drawn at full contrast. Everything else is drawn at reduced contrast. Markers render as underlined
spans with `data-markers`, and as a short connector stub from the span's right edge to the
branch's connector.

## Mounting and clipping

- `__farabiTextStats()` returns `{ mounted: number, chars: number, pinned: string[], offscreenMounted: number }`.
  `offscreenMounted` counts mounted items that are neither in the viewport plus overscan nor
  pinned. It must be 0 after the camera has been idle for 200 ms (SC-006).
- An item's last mounted run carries `data-clipped="true"` when text was cut. Zooming in grows
  `chars` for that item, and the element's full text is mounted once its budget allows (story 2).
- Pinned items (selection, composer with text, streaming) stay mounted off-screen (FR-034,
  SC-007).

## Pointer, wheel and keyboard

| Input | On text | On element frame | On background |
|-------|---------|------------------|---------------|
| press-drag | native text selection | move the element (`Alt` moves its tree, and the origin handle moves its tree) | pan |
| click without drag | place the caret (no focus change) | focus the element | clear the toolbar, keep focus |
| click on a marker | walk to its edge (a menu when several overlap) | n/a | n/a |
| wheel or two-finger scroll | pan | pan | pan |
| `Ctrl`/`Cmd` + wheel, or pinch | zoom at the pointer | same | same |

Keyboard, when focus isn't in an input:

- `Alt+↑` walks to the parent, `Alt+↓` to the first child, and `Alt+←`/`Alt+→` to the previous or
  next sibling.
- `Esc` clears the selection.
- `/` focuses the composer.

Any of these walks counts as a walk for the camera.

A drag past 4 px never focuses (FR-037). Drags send exactly one position write on release.

## Camera (R11)

- `__farabiCamera()` returns `{ mode: "follow" | "free", target: string | null, x, y, scale, moves: number }`.
  `moves` counts automatic camera moves since load. A test reads it before and after non-user
  events (SC-008).
- A send or walk sets follow on the new element and glides until it is in view, finishing within
  1 s.
- A manual pan, zoom or pinch sets free.
- Nothing else changes the camera.
- Zoom limits are 0.02 to 4, further clamped so the project bounds never shrink below a quarter of
  the screen.

## Composer (R12)

- `[data-testid=composer]` is pinned below the focused element, or docked to the viewport edge
  with a pointer (`data-docked="true"`) when the element is off-screen.
- Placeholder text:
  - "Ask a follow-up…" on an answer
  - "Send your next message…" on an edge
  - "Ask about the highlighted text…" on an unsent branch
  - "Start a new tree…" on the empty canvas or after "New tree"
- Send, Stop, the rounded input and the icon buttons follow Feature 7.
- Typing exactly `????` sends at once when a quick branch is possible (Feature 2 behaviour).
- An error appears above the input with Retry, and the draft is kept (FR-015).
- Drafts are kept per target element id, across reloads.

## Selection toolbar

Over a valid selection inside one mounted element, the toolbar shows Define, Branch and Park, as
in Features 2 and 8, including the inline question step for Branch and Park. A cross-element
selection shows nothing.

## Side panel (Feature 8)

The Branches tab lists the direct child edges of the focused element, newest first. Each entry
shows its first words or its anchor text and its state, and clicking it walks there. The Parked tab
is unchanged.

## Minimap (FR-027)

- `[data-testid=minimap]` sits at the bottom-right, 220×160, and can be hidden with
  `[data-testid=minimap-toggle]`. The toggle is persisted per browser.
- It draws every element as a 1–2 px point coloured by tree, a faint region around each tree and
  the viewport rectangle.
- Click centres the camera on that point, and drag moves it continuously. The camera mode becomes
  free.
- `__farabiMinimap()` returns `{ viewport: {x,y,w,h}, bounds }` for SC-012 checks.

## Function UI (Feature 9, re-expressed)

- The `ƒ` button in the focused answer's frame header opens `[data-testid=function-menu]`, which
  lists functions for that kind. Running it shows a working state on the frame, and failure shows
  an error with Retry and creates nothing.
- Each output card has Confirm, Reject and Run again. Run again adds a sibling output under the
  same edge.
- The edge chip has Settings for the per-edge override.
- "Show rejected" in the canvas menu is persisted per browser.

## Empty and loading states

- **Empty project**: a centred invitation, "Ask anything to start a tree", with the composer. The
  first send creates the origin edge (story 1).
- **Loading**: the drawn layer shows frames as soon as layout is known, and text mounts in the
  next frames.

## Test hooks

The hooks are present only with `NEXT_PUBLIC_FARABI_TEST_HOOKS=1`:

- `__farabiCanvasDebug()` returns `{ elements: [{ id, kind, shape, x, y, w, h, treeId, focused, onPath }], trees: { [id]: box } }`
- `__farabiScreenPoint(id, part?: "frame" | "text")`
- `__farabiCanvasDrift()`
- `__farabiTextStats()`
- `__farabiCamera()`
- `__farabiMinimap()`
- `__farabiFrameStats(ms)` resolves with `{ p50, p95, max }` frame times sampled over `ms`

## Accessibility

- Every mounted item has `role="article"` and an `aria-label`: "Your message" or "AI answer" plus
  its state.
- Overlays are keyboard reachable.
- With reduced motion, glides become instant.
