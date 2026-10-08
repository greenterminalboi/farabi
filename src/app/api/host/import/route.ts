import { ImportFailed, ImportRefused, runImport } from "@/server/db/importWeb";
import { regenerateFeedbackFile } from "@/server/feedback/exportFile";
import { BridgeError, isDesktop } from "@/server/host/bridge";
import { readJson, withApi } from "@/server/http/withApi";
import { loadConfig } from "@/server/settings/config";
import { ImportBody } from "@/shared/desktop";

/**
 * The one-time import (FR-017), run in the request: all or nothing. 409 for a refusal that depends
 * on the data (already imported, not empty), 422 for one the user can fix at the source, 500 after
 * a rollback.
 */
export const POST = withApi(async (req: Request) => {
  if (!isDesktop()) throw new BridgeError("unsupported", "Only available in the desktop app");
  const body = await readJson(req, ImportBody);
  try {
    const result = await runImport(body);
    // The imported settings and feedback take effect now.
    await loadConfig();
    await regenerateFeedbackFile().catch((err) => console.error("Feedback export after import failed", err));
    return Response.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ImportRefused) {
      const status = err.reason === "already_imported" || err.reason === "destination_not_empty" ? 409 : 422;
      return Response.json({ error: { code: err.reason, message: err.message } }, { status });
    }
    if (err instanceof ImportFailed) {
      return Response.json({ error: { code: "import_failed", message: err.message }, outcome: "failed", runId: err.runId }, { status: 500 });
    }
    throw err;
  }
});
