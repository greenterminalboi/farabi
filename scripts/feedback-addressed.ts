// npm run feedback:addressed -- <item id>
// Marks one open feedback item as addressed (ai_suggested). Nothing else: no options, no other
// states, no edits (contracts/feedback-file.md, FR-019, FR-020).
import { createDb } from "../src/server/db/client";
import { currentState, markAddressed } from "../src/server/feedback/state";
import { loadEnv } from "./env";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

loadEnv();
const args = process.argv.slice(2);
if (args.length !== 1 || !UUID.test(args[0])) {
  console.error("Usage: npm run feedback:addressed -- <item id>   (the full id from feedback/FEEDBACK.md)");
  process.exit(1);
}
const id = args[0].toLowerCase();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const db = createDb(url);
let code = 1;
try {
  const result = await markAddressed(id, db);
  if (result === "addressed") {
    console.log(`Marked ${id} addressed.`);
    code = 0;
  } else if (result === "not_open") {
    console.log(`${id} is ${await currentState(id, db)}; only open items can be marked addressed. No change.`);
    code = 2;
  } else {
    console.log(`No feedback item ${id}.`);
    code = 3;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  code = 1;
} finally {
  await db.destroy();
}
process.exit(code);
