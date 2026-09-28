# Contract: UI

Tests rely on the roles, names and test ids below.

## Highlight toolbar (`src/components/chat/BranchAction.tsx`)

**Step 1** (unchanged conditions, FR-006): the toolbar has three buttons, **Define**, **Branch**
and **Park**. Park's title is "Save this text as a tangent for later".

**Step 2**: clicking Branch or Park turns the toolbar into a form (`data-testid="branch-question-form"`).

- **Contents**:
  - A text input labelled "Your question (optional)", focused automatically.
  - A confirm button named exactly as the action, "Branch" or "Park".
  - A "Cancel" button. Esc does the same.
- **Enter or confirm**:
  - Branch creates the branch through the existing endpoint. It then sets the new node's draft to
    the typed question, or to the anchor text if the question was blank, and navigates to the
    branch (FR-009, FR-010).
  - Park calls `api.park`, clears the selection, and shows a toast
    (`data-testid="parked-notice"`) "Parked · View". "View" opens the Parked tab. The user stays
    in the conversation and the composer draft is untouched (US1-5).
- **Cancel or Esc**: returns to having no toolbar. Nothing is written (US1-6).
- **Frozen anchor**: while the form is open, the captured anchor doesn't change, even though the
  document selection moves into the input.

## Branch panel (`src/components/chat/BranchPanel.tsx`), inside a node's chat view only

- **Container**: `<aside aria-label="Branch queue" data-testid="branch-panel">`, to the right of the
  chat in the main row. Layout details are in research R7.
- **Header**:
  - A `tablist` with two tabs, "Branches N" and "Parked N". Their accessible names start with
    "Branches" and "Parked".
  - A collapse toggle named "Hide branch panel" or "Show branch panel". Its state is saved per
    browser. The panel is open by default.
- **Following the open node**: both tabs show the open node's data from `NodeView` and update
  when the node changes and on the existing polling (FR-004).

### Branches tab (`data-testid="branches-tab"`)

- Each row is a link to `/n/{childId}`. It shows the child's summary text, the quoted anchor text
  in muted type, and the message count.
- Clicking a row behaves exactly like opening that node from the map (US3-2).
- **Empty state** (`data-testid="branches-empty"`): "No branches from this conversation yet.
  Select text and choose Branch."

### Parked tab (`data-testid="parked-tab"`)

Each item is `<li data-testid="parked-item">`.

- **Main area**: the quoted anchor text. Below it, the question if there is one, or the muted
  words "No question: opens with the highlighted text".
- **Main button**: named "Open as branch" when there's no question and "Ask in new branch" when
  there is one. Clicking it:
  1. calls `api.fireParked`
  2. for the `sent` kind, navigates to the branch, where the reply streams (FR-012)
  3. for the `preload` kind, sets the new node's draft to `draft` and then navigates (FR-013)

  The button is disabled while the request is in flight.
- **"Edit question"**: turns the question into an inline input.
  - Enter saves with `api.setParkedQuestion`. An empty value clears the question.
  - Esc cancels.
- **"Discard"**: removes the item after one click, with no confirmation. It is an unsent draft.
  - The item stays hidden while the request runs.
  - If the request fails, the item is restored and an error is shown.
- **Empty state** (`data-testid="parked-empty"`): "Nothing parked. Select text and choose Park to
  save a tangent for later."
- **Errors**: a `409 parked_consumed` response on fire, edit or discard reloads the node view, so
  the stale item disappears without any other error.

## Composer

No component change. It already shows `viewStore.byNode[nodeId].draft`, and the branch flows
seed that draft before navigating.

## Unchanged

- Map view shows nothing about parked items.
- Message text shows no mark for parked spans. Existing branch markers, definition underlines and
  suggested underlines render as today.
