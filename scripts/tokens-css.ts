// `npm run tokens:css`: rewrites the generated colour-token block of src/app/globals.css from
// src/shared/theme/tokens.ts (the one source of truth). tests/unit/theme-tokens.test.ts fails while
// the two disagree.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CSS_BEGIN, CSS_END, tokensCss } from "../src/shared/theme/tokens";

const file = path.join(process.cwd(), "src/app/globals.css");
const css = readFileSync(file, "utf8");
const start = css.indexOf(CSS_BEGIN);
const end = css.indexOf(CSS_END);
if (start < 0 || end < start) throw new Error(`globals.css has no "${CSS_BEGIN}" … "${CSS_END}" block`);
const next = css.slice(0, start) + tokensCss() + css.slice(end + CSS_END.length);
if (next === css) console.log("globals.css tokens are up to date.");
else {
  writeFileSync(file, next);
  console.log("globals.css tokens regenerated.");
}
