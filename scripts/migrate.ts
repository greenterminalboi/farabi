// `npm run db:migrate [-- --data-dir <folder>]`: brings a data folder up to date the way the app
// does on start (feature 11, data-model.md §6): a verified copy of the closed store first, put
// back if a migration fails. The app migrates its own data, so this refuses while it runs (exit 2).
import { loadEnv, QUIT_FIRST, withTarget } from "./env";

loadEnv();
process.exit(
  await withTarget({
    refuseWhenLive: QUIT_FIRST,
    store: async () => {
      const { prepareStore, StartupBlocked } = await import("../src/server/db/startup");
      try {
        console.log(`Up to date at ${await prepareStore()}.`);
        return 0;
      } catch (err) {
        if (!(err instanceof StartupBlocked)) throw err;
        console.error(err.message);
        return 1;
      }
    },
  }),
);
