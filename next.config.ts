import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite loads its .wasm/.data files from its own package folder at runtime (feature 11).
  serverExternalPackages: ["pg", "@electric-sql/pglite", "@electric-sql/pglite-pgvector"],
  // Test builds use their own folder so they never disturb a running `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // The desktop app ships the standalone server (feature 11, research R3); `next start` doesn't
  // support standalone output, so it stays opt-in for the web app and its tests.
  output: process.env.FARABI_STANDALONE === "1" ? "standalone" : undefined,
};

export default nextConfig;
