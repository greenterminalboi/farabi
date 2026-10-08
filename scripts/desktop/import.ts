// npm run desktop:import -- [connectionString] [--attachments <web app's feedback folder>] [--data-dir <dir>]
// Imports the web app's database into the desktop app's data, once (feature 11, FR-017,
// contracts/cli.md). With the app open it goes through the app; otherwise it opens the store.
import { callLive, loadEnv, resolveTarget, scriptArgs, withTarget } from "../env";

const DEFAULT_SOURCE = "postgres://farabi:farabi@127.0.0.1:5432/farabi";

loadEnv();
const args = scriptArgs();
const a = args.indexOf("--attachments");
const attachmentsDir = a >= 0 ? args[a + 1] : undefined;
const positional = a >= 0 ? [...args.slice(0, a), ...args.slice(a + 2)] : args;
const body = { connectionString: positional[0] ?? DEFAULT_SOURCE, ...(attachmentsDir ? { attachmentsDir } : {}) };

// The source is Postgres by definition; the target is always the desktop store, never DATABASE_URL.

delete process.env.DATABASE_URL;
const target = resolveTarget();

function print(result: { counts: Record<string, number>; checksumsMatch: boolean; attachmentsCopied: number }): void {
  for (const [table, n] of Object.entries(result.counts)) if (n) console.log(`${String(n).padStart(8)}  ${table}`);
  console.log(`Checksums match: ${result.checksumsMatch ? "yes" : "no"} · attachment files copied: ${result.attachmentsCopied}`);
}

const code = await withTarget({
  target,
  live: async (t) => {
    const res = await callLive(t, "POST", "/api/host/import", body);
    const json = (await res.json()) as { error?: { message: string }; counts: Record<string, number>; checksumsMatch: boolean; attachmentsCopied: number };
    if (!res.ok) {
      console.error(json.error?.message ?? `Farabi answered ${res.status}`);
      return res.status === 409 || res.status === 422 ? 2 : 1;
    }
    print(json);
    return 0;
  },
  store: async () => {
    const { ImportFailed, ImportRefused, runImport } = await import("../../src/server/db/importWeb");
    const { prepareStore } = await import("../../src/server/db/startup");
    // A store the app hasn't opened yet (or an older one) is brought up to date first, with a backup.
    await prepareStore();
    await (await import("../../src/server/settings/config")).loadConfig();
    try {
      print(await runImport(body));
      return 0;
    } catch (err) {
      if (err instanceof ImportRefused) {
        console.error(err.message);
        return 2;
      }
      if (err instanceof ImportFailed) {
        console.error(`The import failed and nothing was kept: ${err.message}`);
        return 1;
      }
      throw err;
    }
  },
});
process.exit(code);
