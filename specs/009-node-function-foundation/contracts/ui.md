# Contract: UI

The test ids listed here are what the e2e tests rely on.

## Map (`MapRenderer`, `MapHost`)

### Output node box

- **Header tag**: `AI · <kind label>`, for example "AI · Analogy".
- **Label**: `output.displayedText`. The box grows to fit, as conversation boxes do.
- **Styling**:
  - AI-tinted fill.
  - Dashed outline while `review = proposed`, solid once confirmed (FR-016, SC-010).
- **Stale** (`output.stale`): a "Stale · ↻ Regenerate" pill at the top right. Clicking it
  regenerates. While working it shows "Regenerating…", and on failure it shows "Failed · Retry"
  (FR-023).
- **Pending draft**: a small dot with the tooltip-equivalent label "New draft".
- **Rejected**: hidden unless "Show rejected" is on; then drawn at 40 % alpha.

### Pipe

- **Shape**: a horizontal curve from the input's right edge to the output's left edge, with an
  arrowhead at the output.
- **Colour and state**: the AI colour. Dashed at 60 % alpha while proposed, solid once
  confirmed. Visibly unlike the grey vertical parent-child edges.
- **Click**: opens `PipeCard` (`data-testid="pipe-card"`) at the click point, showing:
  - the function name and version (`pipe-function`)
  - what is read, for example "reads the summary" (`pipe-reads`)
  - the state (`pipe-state`: Proposed, Confirmed or Rejected)
  - the number of versions and whether the output is stale (`pipe-versions`)
  - links "Open input" and "Open analogy"

  Escape or a click outside closes it. No conversation opens (US2 AS4).

### Selection and functions

- A single click on a conversation node selects it (unchanged). A `map-functions-button`
  appears beside the selected node and opens `FunctionMenu`.
- A double-click opens the node's kind view at `/n/{id}` (FR-004).

### "Show rejected" toggle

`map-show-rejected`, in the map's lower-left corner, persisted per browser.

### Test hooks

- `__farabiMapDebug.nodes[]` gains `kind`, `review`, `stale` and `pendingDraft`.
- `__farabiMapDebug.pipes`: `Array<{ id, from, to, state }>`, visible pipes only.
- `__farabiMapPipePoint(pipeId)`: page coordinates of a pipe's midpoint.
- `__farabiMapBadgePoint(nodeId)`: page coordinates of an output's stale pill.

## `FunctionMenu` (map and chat header)

- **Opening**: from `map-functions-button` or from `node-functions-button` in `NodeHeader`. The
  menu has `data-testid="function-menu"`.
- **Items**: one per listed function, `function-item-<id>`.
  - An available item is a button.
  - An unavailable item is disabled and shows its reason (`function-unavailable-reason`), for
    example "This conversation has no summary yet: it needs a completed AI reply."
- **Running**: the item shows "Working…" and the menu can't start a second run.
- **Success**:
  - On the map: the menu closes, the map refreshes at once, and the new output is selected.
  - In chat: the menu shows "Analogy ready" with an `function-open-output` link.
- **Failure**: `function-error` shows the server message, with `function-retry`.

## `OutputView` (`/n/{outputId}`, view `output_beside_input`) (FR-019)

The view has two columns, `output-panel` and `input-panel`. They stack at narrow widths.

### `output-panel`

- **Heading**: "AI · Analogy".
- **Text**: the displayed text (`output-text`).
- **State chip**: `output-state` reads "Proposed", "Confirmed" or "Rejected".
- **Stale**: `stale-badge` ("Made from an older summary") with `regenerate-button`. Both are
  shown only when stale.
- **Pending draft**: `draft-panel` shows the draft text with `confirm-draft` ("Use this
  version"). It is shown only when `pendingDraft`.
- **Actions**:
  - `confirm-output` is shown when proposed or rejected.
  - `reject-output` is shown when not rejected.
- **Versions**: `versions-list`, collapsible, newest first. Each entry shows its time, settings
  and a confirmed marker.
- **Settings for this analogy**: `node-settings`. There is one `node-setting-<key>` select per
  declared setting, with "Use default (<kind value or default>)" as the first option. When an
  override is in effect, the note "Overriding the setting for all analogies" appears
  (`node-setting-override-note-<key>`). Choosing the first option clears the override.

### `input-panel`

- The input's summary label.
- The read-only conversation (`input-conversation`). No highlight toolbar, no markers, no
  composer.
- `open-input`, a link to `/n/{inputId}`.

There is no Branch, Define or Park anywhere in this view (FR-005).

## `PipeView` (`/n/{pipeId}`)

The same fields as `PipeCard`, as a page.

## Settings page (FR-031, SC-007)

- Below the existing Feature 6 sections, a "Node kinds" heading. `KindSettingsSections` renders
  one `kind-settings-<kind>` section per kind that declares settings.
- Each setting is a `kind-setting-<kind>-<key>` select, with its choices and a
  "(default)" suffix on the default.
- Saving shows the existing "Saved" status. Nothing else happens.
- The component iterates the kind registry, so a new kind's section appears with no page edit.

## `NodeHeader` (chat)

- Gains `node-functions-button` ("Functions"). Everything else is unchanged.
