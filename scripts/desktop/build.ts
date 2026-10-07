// npm run desktop:build: fetch Node, build the standalone server, prepare it, then `tauri build`
// for the host target. Prints each installer's size and fails at 100 MB or more (SC-002).
import { execFileSync } from "node:child_process";
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const LIMIT_MB = 100;
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const run = (cmd: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env }, shell: process.platform === "win32" });

run(npx, ["tsx", "scripts/desktop/fetch-node.ts"]);
run(npx, ["next", "build"], { FARABI_STANDALONE: "1", NEXT_DIST_DIR: ".next-desktop" });
run(npx, ["tsx", "scripts/desktop/prepare-server.ts"], { NEXT_DIST_DIR: ".next-desktop" });
run(npx, ["tauri", "build", ...process.argv.slice(2)]);

const bundleDir = path.join(ROOT, "src-tauri", "target", "release", "bundle");
let failed = false;
for (const sub of ["dmg", "nsis"]) {
  const dir = path.join(bundleDir, sub);
  if (!existsSync(dir)) continue;
  for (const f of await fs.readdir(dir)) {
    if (!/\.(dmg|exe)$/.test(f)) continue;
    const mb = (await fs.stat(path.join(dir, f))).size / 1024 / 1024;
    console.log(`${path.relative(ROOT, path.join(dir, f))}: ${mb.toFixed(1)} MB`);
    if (mb >= LIMIT_MB) failed = true;
  }
}
if (failed) {
  console.error(`An installer is ${LIMIT_MB} MB or larger (SC-002).`);
  process.exit(1);
}
