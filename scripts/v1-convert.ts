// `npm run v1:convert`: runs the v1 → v2 converter again, in one transaction. It is idempotent, so
// after the migration it should report 0 new rows (research R3). `--test` targets the test database.
import { createDb } from "../src/server/db/client";
import { convertV1, printReport } from "../src/server/db/v1/convert";
import { loadEnv } from "./env";

loadEnv();
const useTest = process.argv.includes("--test");
const url = useTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
if (!url) throw new Error(`${useTest ? "TEST_DATABASE_URL" : "DATABASE_URL"} is not set`);
const db = createDb(url);
try {
  const report = await db.transaction().execute((trx) => convertV1(trx));
  const inserted = Object.entries(report)
    .filter(([rule]) => !rule.startsWith("skipped_") && !rule.startsWith("quick_branches_on"))
    .reduce((sum, [, n]) => sum + n, 0);
  printReport(report);
  console.log(`${inserted} new rows`);
} finally {
  await db.destroy();
}
