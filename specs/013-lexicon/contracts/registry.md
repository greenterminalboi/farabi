# Contract: Lexicon registry (`src/shared/lexicon`)

New shared contract, beside `src/shared/kinds`. Plain data plus pure functions; imported by the
server and the client. Owner: lexicon lane until merged, then v0.2.

```ts
type Slot = "operation" | "scope" | "format" | "tone" | "audience" | "strength" | "quality";
const SLOT_ORDER: Slot[];                 // the order above; block and chips follow it
const SINGLE_SLOTS: ReadonlySet<Slot>;    // operation, scope, format, tone, audience
const MAX_TERMS = 6;
type Term = { id; name; aliases; slot; meaning; example; neighbours; conflicts; version;
              instruction; effect; check?; retired? };
type TermUse = { id: string; v: number };
const LexiconUses: z.ZodType<TermUse[]>;  // max 6, unique ids (used by the kind properties)

allTerms(): Term[]                        // every term, retired included, in slot order then name
activeTerms(): Term[]
findTerm(id): Term | undefined
roleOf(term): "operation" | "modifier"
searchTerms(query, among?): Term[]        // name/alias prefix first, then substring; case-insensitive
unavailableReason(id, selected: string[]): string | null
   // "Already added" | "Scope already set: Concise" | "Conflicts with Verbatim"
   // | "Six terms at most" | "Retired" | "Unknown term"
checkSelection(ids: string[]): { ok: true; terms: Term[] } | { ok: false; reason: string }
sortBySlot(terms): Term[]                 // SLOT_ORDER, then id
lexiconBlock(terms: Array<Pick<Term,"id"|"version"|"slot"|"instruction">>): string | null
runCheck(checkId, output): boolean        // checks.ts
```

Adding a term: add an entry to its slot's JSON, run `npm run lexicon:lock`, run the tests.
Changing an instruction: bump `version`, then lock. Withdrawing: set `retired: true`, never delete.
