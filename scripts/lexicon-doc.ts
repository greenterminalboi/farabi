// npm run lexicon:doc
// Prints the lexicon as a readable markdown document, grouped by slot. The Claude Doc is a view of
// the repo data: paste this output into it (FR-021).
import { allTerms } from "../src/shared/lexicon";
import { lexiconDoc } from "../src/shared/lexicon/doc";

process.stdout.write(lexiconDoc(allTerms()));
