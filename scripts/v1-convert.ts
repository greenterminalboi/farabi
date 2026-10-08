// `npm run v1:convert`: runs the v1 → v2 converter again, in one transaction. It is idempotent, so
// after the migration it should report 0 new rows (research R3).
// Refuses while the desktop app is running on the data (feature 11).
import { loadEnv, QUIT_FIRST, withTarget } from "./env";

loadEnv();
const code = await withTarget({
  refuseWhenLive: QUIT_FIRST,
  store: async () => {
    const { db } = await import("../src/server/db/client");
    const { convertV1, printReport } = await import("../src/server/db/v1/convert");
    const report = await db.transaction().execute((trx) => convertV1(trx));
    const inserted = Object.entries(report)
      .filter(([rule]) => !rule.startsWith("skipped_") && !rule.startsWith("quick_branches_on"))
      .reduce((sum, [, n]) => sum + n, 0);
    printReport(report);
    console.log(`${inserted} new rows`);
    return 0;
  },
});
process.exit(code);
