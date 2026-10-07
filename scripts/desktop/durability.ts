// npm run desktop:durability -- [--kills N] [--fsync-probe] [--writer-only DIR] [--verify DIR]
// Gate G2 (feature 11, research R2, quickstart V2): is a PGlite store on disk still consistent,
// with every committed row present, after the process writing to it is killed mid-write?
//
//   --kills N        G2a: N rounds of "write, SIGKILL at a random moment, reopen and check".
//   --fsync-probe    G2b: reports whether commits reach the disk (see the printed instructions).
//   --writer-only D  G2c: just write to D until killed (run in a VM, then hard-reset the VM).
//   --verify D       G2c: check D after the reboot.
//
// The writer records each committed id in a side log, fsync'd after the commit returns. Every id
// in that log must be in the store afterwards.
import { amcheck } from "@electric-sql/pglite/contrib/amcheck";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { spawn } from "node:child_process";
import { existsSync, fsyncSync, mkdtempSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Migrator } from "kysely/migration";
import { createDb } from "../../src/server/db/client";
import { migrationProvider } from "../../src/server/db/migrationList";
import { pidAlive, readLock, releaseStoreLock } from "../../src/server/db/storeLock";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.indexOf(name);
const sideLog = (dir: string) => path.join(dir, "committed.log");

/** Creates the store and runs every migration, so the writer starts from a real schema. */
async function prepare(dir: string): Promise<void> {
  const db = createDb({ kind: "pglite", dataDir: dir });
  const { error } = await new Migrator({ db, provider: migrationProvider }).migrateToLatest();
  if (error) throw error;
  await db.destroy();
  releaseStoreLock(dir);
}

/** Writes until killed: a project and a setting per transaction, plus an update in place. */
async function writer(dir: string): Promise<never> {
  const db = createDb({ kind: "pglite", dataDir: dir });
  const log = openSync(sideLog(dir), "a");
  let n = 0;
  for (;;) {
    const id = await db.transaction().execute(async (trx) => {
      const p = await trx.insertInto("projects").values({ name: `durability ${n}` }).returning("id").executeTakeFirstOrThrow();
      await trx
        .insertInto("setting_changes")
        .values({ key: "information_pressure", value: JSON.stringify((n % 10) + 1) })
        .execute();
      return p.id;
    });
    // Like a reply checkpoint: rewrite the same row repeatedly.
    await db.updateTable("projects").set({ name: `durability ${n} ✓` }).where("id", "=", id).execute();
    writeSync(log, `${id}\n`);
    fsyncSync(log);
    n++;
  }
}

type Check = { ok: boolean; committed: number; missing: number; rows: number; indexErrors: string[]; error?: string };

/** Reopens the store and checks it: opens at all, indexes pass amcheck, no committed id missing. */
async function verify(dir: string): Promise<Check> {
  const ids = existsSync(sideLog(dir)) ? readFileSync(sideLog(dir), "utf8").split("\n").filter(Boolean) : [];
  // The killed writer leaves a stale lock behind; a live holder would be a harness bug.
  const holder = readLock(dir);
  if (holder && pidAlive(holder.pid)) throw new Error(`store still held by live process ${holder.pid}`);
  if (holder) releaseStoreLock(dir, holder.pid);
  const pg = new PGlite({ dataDir: path.join(dir, "store"), extensions: { vector, amcheck } });
  try {
    await pg.exec("CREATE EXTENSION IF NOT EXISTS amcheck");
    const indexErrors: string[] = [];
    const { rows: indexes } = await pg.query<{ name: string }>(
      `SELECT c.oid::regclass::text AS name FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
       JOIN pg_am a ON a.oid = c.relam JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE a.amname = 'btree' AND n.nspname = 'public'`,
    );
    for (const { name } of indexes) {
      try {
        await pg.query(`SELECT bt_index_check($1::regclass, true)`, [name]);
      } catch (err) {
        indexErrors.push(`${name}: ${(err as Error).message}`);
      }
    }
    const { rows: present } = await pg.query<{ id: string }>(`SELECT id::text FROM projects WHERE name LIKE 'durability %'`);
    const have = new Set(present.map((r) => r.id));
    const missing = ids.filter((id) => !have.has(id)).length;
    return { ok: missing === 0 && indexErrors.length === 0, committed: ids.length, missing, rows: have.size, indexErrors };
  } catch (err) {
    return { ok: false, committed: ids.length, missing: -1, rows: -1, indexErrors: [], error: (err as Error).message };
  } finally {
    await pg.close().catch(() => undefined);
  }
}

function spawnWriter(dir: string) {
  return spawn(process.execPath, [...process.execArgv, import.meta.filename, "--child", dir], { stdio: ["ignore", "ignore", "inherit"] });
}

async function kills(rounds: number): Promise<boolean> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "farabi-g2a-"));
  await prepare(dir);
  console.log(`G2a: ${rounds} kills on ${dir}`);
  let failures = 0;
  for (let i = 1; i <= rounds; i++) {
    const child = spawnWriter(dir);
    // Let it open the store and get going, then kill it at a random moment.
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 2500));
    child.kill("SIGKILL");
    await new Promise((r) => child.once("exit", r));
    const check = await verify(dir);
    if (!check.ok) failures++;
    console.log(
      `${String(i).padStart(2)} ${check.ok ? "ok  " : "FAIL"} committed=${check.committed} present=${check.rows} missing=${check.missing}` +
        (check.indexErrors.length ? ` indexErrors=${check.indexErrors.length}` : "") +
        (check.error ? ` error=${check.error}` : ""),
    );
  }
  console.log(failures ? `G2a FAILED: ${failures}/${rounds} rounds lost data or corrupted the store.` : `G2a passed: ${rounds}/${rounds}.`);
  if (!failures) rmSync(dir, { recursive: true, force: true });
  return failures === 0;
}

function fsyncProbe(): void {
  console.log(`G2b: PGlite runs Postgres with -F (fsync off) and Emscripten's NODEFS has no fsync (research R2).
Measure it on this machine: start a writer, then trace its fsync calls for 10 s.

  macOS:   npm run desktop:durability -- --writer-only /tmp/farabi-g2b &
           sudo dtruss -f -t fsync -p $! 2>&1 | head      # also try -t fcntl for F_FULLFSYNC
  Windows: run the writer, then Process Monitor with a filter on Operation = FlushBuffersFile

Only the side log's fsync should appear. If the store's files never show up, commits don't reach the
disk and the power-loss edge case depends on snapshots (T074, required by the coordinator).`);
}

async function main(): Promise<void> {
  if (flag("--child") >= 0) return void (await writer(argv[flag("--child") + 1]));
  if (flag("--fsync-probe") >= 0) return fsyncProbe();
  if (flag("--writer-only") >= 0) {
    const dir = argv[flag("--writer-only") + 1];
    if (!existsSync(path.join(dir, "store"))) await prepare(dir);
    console.log(`Writing to ${dir}; hard-reset the machine, then run --verify ${dir}`);
    return void (await writer(dir));
  }
  if (flag("--verify") >= 0) {
    const check = await verify(argv[flag("--verify") + 1]);
    console.log(JSON.stringify(check, null, 2));
    process.exit(check.ok ? 0 : 1);
  }
  const k = flag("--kills");
  const ok = await kills(k >= 0 ? Number(argv[k + 1]) : 50);
  process.exit(ok ? 0 : 1);
}

await main();
