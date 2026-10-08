// npm run feedback:addressed -- <item id>
// Marks one open feedback item as addressed (ai_suggested). Nothing else: no options, no other
// states, no edits (contracts/feedback-file.md, FR-019, FR-020). With the desktop app open it goes
// through the app; otherwise it opens the data directly (feature 11, contracts/cli.md).
import { callLive, loadEnv, scriptArgs, withTarget } from "./env";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

loadEnv();
const args = scriptArgs();
if (args.length !== 1 || !UUID.test(args[0])) {
  console.error("Usage: npm run feedback:addressed -- <item id>   (the full id from feedback/FEEDBACK.md)");
  process.exit(1);
}
const id = args[0].toLowerCase();

function report(result: "addressed" | "not_open" | "not_found", state?: string | null): number {
  if (result === "addressed") {
    console.log(`Marked ${id} addressed.`);
    return 0;
  }
  if (result === "not_open") {
    console.log(`${id} is ${state}; only open items can be marked addressed. No change.`);
    return 2;
  }
  console.log(`No feedback item ${id}.`);
  return 3;
}

let code = 1;
try {
  code = await withTarget({
    live: async (target) => {
      const res = await callLive(target, "POST", `/api/feedback/${id}/addressed`);
      if (res.status === 404) return report("not_found");
      const body = (await res.json()) as { result?: "addressed" | "not_open"; state?: string };
      if (!res.ok && res.status !== 409) throw new Error(`Farabi answered ${res.status}`);
      return report(body.result ?? "not_found", body.state);
    },
    store: async () => {
      const { currentState, markAddressed } = await import("../src/server/feedback/state");
      const result = await markAddressed(id);
      return report(result, result === "not_open" ? await currentState(id) : null);
    },
  });
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  code = 1;
}
process.exit(code);
