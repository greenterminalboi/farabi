import { checkImport } from "@/server/db/importWeb";
import { BridgeError, isDesktop } from "@/server/host/bridge";
import { readJson, withApi } from "@/server/http/withApi";
import { ImportBody } from "@/shared/desktop";

/** Whether the web app's database can be imported, with its row counts or the reason it can't. */
export const POST = withApi(async (req: Request) => {
  if (!isDesktop()) throw new BridgeError("unsupported", "Only available in the desktop app");
  return Response.json(await checkImport(await readJson(req, ImportBody)));
});
