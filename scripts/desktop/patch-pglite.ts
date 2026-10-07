// postinstall: gives PGlite's Postgres a microsecond wall clock (feature 11, gate G3).
//
// PGlite's Emscripten runtime answers CLOCK_REALTIME with Date.now(), which has millisecond
// resolution. Farabi orders history by `created_at DEFAULT clock_timestamp()` (Article VI), so rows
// written in the same millisecond would tie and fall back to random-uuid order. Native Postgres
// has microseconds. This swaps the clock source for performance.timeOrigin + performance.now(),
// which has sub-microsecond resolution. Idempotent; fails loudly if PGlite's code changes.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DIST = path.resolve(import.meta.dirname, "../../node_modules/@electric-sql/pglite/dist");
const FROM = "_emscripten_date_now=()=>Date.now()";
const TO = "_emscripten_date_now=()=>performance.timeOrigin+performance.now()";

if (!existsSync(DIST)) process.exit(0); // not installed (yet)
let patched = 0;
let already = 0;
for (const f of readdirSync(DIST)) {
  if (!/\.(c?js)$/.test(f)) continue;
  const file = path.join(DIST, f);
  const src = readFileSync(file, "utf8");
  if (src.includes(TO)) already++;
  if (!src.includes(FROM)) continue;
  writeFileSync(file, src.split(FROM).join(TO));
  patched++;
}
if (patched + already === 0) {
  console.error(`patch-pglite: "${FROM}" not found in ${DIST}. PGlite changed; re-check the clock patch (gate G3).`);
  process.exit(1);
}
console.log(`patch-pglite: microsecond clock in ${patched + already} file(s)${patched ? ` (${patched} patched now)` : ""}.`);
