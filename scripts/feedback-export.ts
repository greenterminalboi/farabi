// npm run feedback:export — regenerates FEEDBACK.md from the data. Changes no data. With the
// desktop app open it asks the app to do it (feature 11, contracts/cli.md).
import { callLive, loadEnv, withTarget } from "./env";

loadEnv();
const code = await withTarget({
  live: async (target) => {
    const res = await callLive(target, "POST", "/api/feedback/export");
    if (!res.ok) throw new Error(`Farabi answered ${res.status}`);
    const { path } = (await res.json()) as { path: string | null };
    console.log(path ?? "Feedback export is off (no export folder chosen in Settings).");
    return 0;
  },
  store: async () => {
    const { regenerateFeedbackFile } = await import("../src/server/feedback/exportFile");
    const { repoRelative } = await import("../src/server/feedback/paths");
    const written = await regenerateFeedbackFile();
    console.log(written ? repoRelative(written) : "Feedback export is off (no export folder chosen in Settings).");
    return 0;
  },
});
process.exit(code);
