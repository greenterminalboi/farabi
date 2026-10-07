// npm run desktop:fetch-node [-- --target <triple>]
// Downloads the pinned official Node binary for a Tauri target and places it where
// tauri.conf.json's externalBin expects it: src-tauri/binaries/node-<triple>[.exe] (research R3).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { promises as fs, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const NODE_VERSION = "24.8.0";
const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT_DIR = path.join(ROOT, "src-tauri", "binaries");

type Dist = { triple: string; archive: string; inner: string; exe: boolean };
const DISTS: Record<string, Dist> = {
  "aarch64-apple-darwin": { triple: "aarch64-apple-darwin", archive: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`, inner: `node-v${NODE_VERSION}-darwin-arm64/bin/node`, exe: false },
  "x86_64-apple-darwin": { triple: "x86_64-apple-darwin", archive: `node-v${NODE_VERSION}-darwin-x64.tar.gz`, inner: `node-v${NODE_VERSION}-darwin-x64/bin/node`, exe: false },
  "x86_64-pc-windows-msvc": { triple: "x86_64-pc-windows-msvc", archive: `node-v${NODE_VERSION}-win-x64.zip`, inner: `node-v${NODE_VERSION}-win-x64/node.exe`, exe: true },
};

function hostTriple(): string {
  if (process.platform === "darwin") return process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  if (process.platform === "win32" && process.arch === "x64") return "x86_64-pc-windows-msvc";
  throw new Error(`No desktop build for ${process.platform}/${process.arch}`);
}

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

async function main() {
  const i = process.argv.indexOf("--target");
  const triple = i >= 0 ? process.argv[i + 1] : hostTriple();
  const dist = DISTS[triple];
  if (!dist) throw new Error(`Unknown target ${triple}; expected one of ${Object.keys(DISTS).join(", ")}`);
  const out = path.join(OUT_DIR, `node-${triple}${dist.exe ? ".exe" : ""}`);
  const base = `https://nodejs.org/dist/v${NODE_VERSION}`;

  // The pinned checksum comes from nodejs.org's SHASUMS256.txt for this exact version.
  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
  const expected = sums.split("\n").find((l) => l.endsWith(`  ${dist.archive}`))?.split(/\s+/)[0];
  if (!expected) throw new Error(`${dist.archive} is not listed in SHASUMS256.txt`);
  const stamp = `${out}.sha256`;
  if (existsSync(out) && existsSync(stamp) && (await fs.readFile(stamp, "utf8")) === expected) {
    console.log(`Node ${NODE_VERSION} for ${triple} is already in place.`);
    return;
  }

  console.log(`Downloading ${dist.archive}…`);
  const res = await fetch(`${base}/${dist.archive}`);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const archive = Buffer.from(await res.arrayBuffer());
  if (sha256(archive) !== expected) throw new Error(`Checksum mismatch for ${dist.archive}`);

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "farabi-node-"));
  const archivePath = path.join(tmp, dist.archive);
  await fs.writeFile(archivePath, archive);
  // bsdtar (macOS and Windows 10+) extracts both .tar.gz and .zip.
  execFileSync("tar", ["-xf", archivePath, "-C", tmp, dist.inner]);
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.copyFile(path.join(tmp, dist.inner), out);
  if (!dist.exe) await fs.chmod(out, 0o755);
  await fs.writeFile(stamp, expected);
  await fs.rm(tmp, { recursive: true, force: true });
  console.log(`Wrote ${path.relative(ROOT, out)}`);
}

await main();
