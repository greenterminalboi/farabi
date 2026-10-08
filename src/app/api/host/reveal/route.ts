import { BridgeError, isDesktop, reveal } from "@/server/host/bridge";
import { revealTarget } from "@/server/host/info";
import { readJson, withApi } from "@/server/http/withApi";
import { RevealBody } from "@/shared/desktop";

/** Shows the data, log or export folder in Finder or Explorer. Never an arbitrary path. */
export const POST = withApi(async (req: Request) => {
  const { target } = await readJson(req, RevealBody);
  if (!isDesktop()) throw new BridgeError("unsupported", "Only available in the desktop app");
  const dir = revealTarget(target);
  if (!dir) throw new BridgeError("forbidden", "That folder isn't set");
  await reveal(dir);
  return new Response(null, { status: 204 });
});
