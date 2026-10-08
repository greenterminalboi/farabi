// Seeds one project with `--elements N` graph elements (default 5,000) over 20 trees, for the
// scale checks (Feature 10, SC-005, T079): question and answer runs, with about 15% of elements
// starting a branch, and answer texts shaped like real replies (research R17).
// `--feedback N` also seeds N feedback items, about a third with a screenshot (Feature 3, SC-008).
// `--outputs N` also runs Analogy on the first N answers: a function edge and one output each.
// `--data-dir <folder>` picks the data folder (default: the installed app's); Farabi must be closed.
import { loadEnv, QUIT_FIRST, resolveTarget, type Target } from "./env";

loadEnv();
const target: Target = resolveTarget();
if (target.kind === "live") {
  console.error(QUIT_FIRST);
  process.exit(2);
}
process.env.FARABI_DATA_DIR = target.dataDir;
process.env.FARABI_HOST = "tauri";
const { db, closeDb } = await import("../src/server/db/client");
const { seedLarge } = await import("../src/server/testing/seedLarge");
await (await import("../src/server/settings/config")).loadConfig().catch(() => undefined);
const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};

console.log(
  await seedLarge(db, { elements: arg("--elements", 5000), feedback: arg("--feedback", 0), outputs: arg("--outputs", 0) }),
);
await closeDb();
