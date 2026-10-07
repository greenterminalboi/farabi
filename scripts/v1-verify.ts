// `npm run v1:verify` (contracts/migration.md): checks the five invariants of the v1 → v2
// conversion and exits 1 if any fails. `--test` targets the test database.
import { createDb } from "../src/server/db/client";
import { verifyV1 } from "../src/server/db/v1/verify";
import { loadEnv } from "./env";

loadEnv();
const useTest = process.argv.includes("--test");
const url = useTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
if (!url) throw new Error(`${useTest ? "TEST_DATABASE_URL" : "DATABASE_URL"} is not set`);
const db = createDb(url);
let failed = false;
try {
  for (const check of await verifyV1(db)) {
    console.log(`${check.ok ? "OK  " : "FAIL"} ${check.name}`);
    for (const d of check.details) console.log(`       ${d}`);
    if (!check.ok) failed = true;
  }
} finally {
  await db.destroy();
}
process.exit(failed ? 1 : 0);
