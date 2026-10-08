# Contract: composer chips, picker, card, canvas row

## Composer
- A chip row above the textarea when the draft has terms: one chip per term in slot order
  (`data-testid="term-chip-<id>"`, a remove button "Remove <name>").
- A "Terms" button inside the form (`data-testid="term-picker-open"`, aria-label "Add a term").
  Keyboard: the button is focusable; the picker opens with focus in its search box.
- Chips persist per draft target with the text (`farabi.drafts` storage) and clear when the message
  is stored. Sending passes the chip ids as `terms`.

## Picker (`data-testid="term-picker"`, role="dialog")
- Search box (aria-label "Search terms"); results grouped by slot, as a listbox with options
  (`data-testid="term-option-<id>"`). Arrow keys move, Enter adds, Escape closes.
- Unavailable terms stay listed, `aria-disabled="true"`, with the reason as visible secondary text.
- With six chips the picker says "Six terms at most" and every option is unavailable.
- Retired terms are not listed.

## Card (`data-testid="term-card"`, role="tooltip")
- Opens on hover (after ~300 ms) or focus of a chip or option; stays while hovered; Escape closes.
- Shows: name, role · slot, meaning, example, neighbours (buttons when shown for a draft chip:
  "Swap for <name>", disabled with reason when unavailable), "Sent to the model" + version + the
  exact instruction.

## Canvas
- A sent question edge with uses shows a footer row of chips (`.lexicon-chip`, text = term name),
  each with a native tooltip: "<name> · <slot> · v<n>" and the instruction (or a note that the
  instruction has changed since). Messages without terms are drawn exactly as before.
