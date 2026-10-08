// `npm run v1:verify` (contracts/migration.md): checks the five invariants of the v1 → v2
// conversion and exits 1 if any fails. Refuses while the
// desktop app is running on the data (feature 11).
import { loadEnv, QUIT_FIRST, withTarget } from "./env";

loadEnv();
const code = await withTarget({
  refuseWhenLive: QUIT_FIRST,
  store: async () => {
    const { db } = await import("../src/server/db/client");
    const { verifyV1 } = await import("../src/server/db/v1/verify");
    let failed = false;
    for (const check of await verifyV1(db)) {
      console.log(`${check.ok ? "OK  " : "FAIL"} ${check.name}`);
      for (const d of check.details) console.log(`       ${d}`);
      if (!check.ok) failed = true;
    }
    return failed ? 1 : 0;
  },
});
process.exit(code);
