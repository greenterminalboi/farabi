// npm run lexicon:lock
// Rewrites src/shared/lexicon/data/versions.lock.json from the term data. Refuses when a term's
// instruction changed without a version increase, or a term was deleted (FR-004).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { allTerms } from "../src/shared/lexicon";
import { buildLock, type Lock, lockProblems } from "../src/server/lexicon/lock";

const file = path.resolve(import.meta.dirname, "../src/shared/lexicon/data/versions.lock.json");
let lock: Lock = {};
try {
  lock = JSON.parse(readFileSync(file, "utf8")) as Lock;
} catch {
  console.log("No lock yet: creating one.");
}
// "Behind" and "not in the lock" are what this script fixes; everything else is refused.
const blocking = lockProblems(allTerms(), lock).filter((p) => !/run npm run lexicon:lock/.test(p));
if (blocking.length) {
  console.error(`Not updating the lock:\n${blocking.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
writeFileSync(file, `${JSON.stringify(buildLock(allTerms()), null, 2)}\n`);
console.log(`Locked ${allTerms().length} terms.`);
