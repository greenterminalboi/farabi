import { listSnapshots, requestRestore } from "@/server/db/snapshots";
import { BridgeError, isDesktop, restartApp } from "@/server/host/bridge";
import { NotFoundError } from "@/server/errors";
import { readJson, withApi } from "@/server/http/withApi";
import { RestoreSnapshotBody } from "@/shared/desktop";

export const dynamic = "force-dynamic";

function dataDir(): string {
  const dir = process.env.FARABI_DATA_DIR;
  if (!isDesktop() || !dir) throw new BridgeError("unsupported", "Only available in the desktop app");
  return dir;
}

/** The automatic snapshots, newest first (T074). */
export const GET = withApi(async () => Response.json({ snapshots: listSnapshots(dataDir()) }));

/** Stages a restore and restarts; the snapshot is loaded while the store is closed. */
export const POST = withApi(async (req: Request) => {
  const { name } = await readJson(req, RestoreSnapshotBody);
  const dir = dataDir();
  try {
    requestRestore(dir, name);
  } catch (err) {
    throw new NotFoundError(err instanceof Error ? err.message : "No such snapshot");
  }
  await restartApp();
  return new Response(null, { status: 202 });
});
