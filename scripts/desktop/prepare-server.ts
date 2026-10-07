// Copies the standalone Next build into .desktop/server/, the folder tauri.conf.json bundles as
// the `server` resource (research R3). Run after `FARABI_STANDALONE=1 next build`.
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIST = path.join(ROOT, process.env.NEXT_DIST_DIR ?? ".next-desktop");
const OUT = path.join(ROOT, ".desktop", "server");

// Runtime assets PGlite reads from its own package folder. Output tracing doesn't always see
// them, because they're loaded by URL rather than imported.
const PGLITE_ASSETS = [
  "@electric-sql/pglite/dist/pglite.wasm",
  "@electric-sql/pglite/dist/pglite.data",
  "@electric-sql/pglite/dist/initdb.wasm",
  "@electric-sql/pglite-pgvector/dist/vector.tar.gz",
];

async function main() {
  const standalone = path.join(DIST, "standalone");
  if (!existsSync(path.join(standalone, "server.js"))) {
    throw new Error(`${path.relative(ROOT, standalone)}/server.js is missing; run FARABI_STANDALONE=1 next build first`);
  }
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.cp(standalone, OUT, { recursive: true, verbatimSymlinks: false, dereference: true });
  await fs.cp(path.join(DIST, "static"), path.join(OUT, path.basename(DIST), "static"), { recursive: true });
  if (existsSync(path.join(ROOT, "public"))) await fs.cp(path.join(ROOT, "public"), path.join(OUT, "public"), { recursive: true });

  for (const asset of PGLITE_ASSETS) {
    const dest = path.join(OUT, "node_modules", asset);
    if (existsSync(dest)) continue;
    const src = path.join(ROOT, "node_modules", asset);
    if (!existsSync(src)) throw new Error(`PGlite asset missing from node_modules: ${asset}`);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
    console.log(`Added untraced asset ${asset}`);
  }
  // Next traces sharp for image optimization, which Farabi doesn't use (no next/image). It's
  // ~28 MB of native per-platform code, so leave it out.
  for (const dep of ["sharp", "@img"]) await fs.rm(path.join(OUT, "node_modules", dep), { recursive: true, force: true });
  // Never ship local env files or dev data inside the app.
  for (const f of await fs.readdir(OUT)) if (f.startsWith(".env")) await fs.rm(path.join(OUT, f));
  console.log(`Server prepared in ${path.relative(ROOT, OUT)}`);
}

await main();
