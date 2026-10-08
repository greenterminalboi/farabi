# Contract: composer chips, picker, card, canvas row

## Composer
- A chip row above the textarea when the draft has terms: one chip per term in slot order
  (`data-testid="term-chip-<id>"`, a remove button "Remove <name>").
- A "Terms" button inside the form (`data-testid="term-picker-open"`, aria-label "Add a term").
  Keyboard: the button is focusable; the picker opens with focus in its search box.
- Chips persist per draft target with the text (`farabi.drafts` storage) and clear when the message
  is stored. Sending passes `terms: [{ id, via }]`.

### Auto-detect (owner decision 2026-10-07)
- When the app setting `lexicon_autodetect` is on (default), term names and aliases in the draft
  text (whole words, any case, no stemming; the alias "can" is excluded) become chips with
  `data-via="detected"`, dashed and labelled "detected". Chips added by hand have `data-via="chip"`.
- Order: chips added by hand first, then detected terms in text order (a swapped-in suggestion
  first). A detected term that clashes with one already chosen (same single slot, or a declared
  conflict) is a dimmed suggestion `data-testid="term-suggestion-<id>"` reading "conflicts with
  <name>", with a button "Use <name> instead of <names>" (swaps it in, dismissing the others) and
  "Dismiss <name>".
- Removing any chip dismisses that term for the draft: it isn't detected again while the draft
  lives, even if the word stays. Adding it from the picker undoes the dismissal. Dismissed and
  swapped-in ids persist per draft (`draftLexicon` in `farabi.drafts`) and clear on send.
- More than eight chips shows `data-testid="term-warning"` (a soft warning); nothing is blocked.
- With the setting off, nothing is detected: exactly the chip-only behaviour.
- Settings → "Lexicon": a checkbox `data-testid="lexicon-autodetect"`, "Pick up lexicon words
  automatically", saved through `PUT /api/settings/app { key: "lexicon_autodetect", value }`.

## Picker (`data-testid="term-picker"`, role="dialog")
- Search box (aria-label "Search terms"); results grouped by slot, as a listbox with options
  (`data-testid="term-option-<id>"`). Arrow keys move, Enter adds, Escape closes.
- Unavailable terms stay listed, `aria-disabled="true"`, with the reason as visible secondary text.
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
