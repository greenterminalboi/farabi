import { currentState, markAddressed } from "@/server/feedback/state";
import { isDesktop } from "@/server/host/bridge";
import { matchesSecret } from "@/server/host/session";
import { withApi } from "@/server/http/withApi";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => Response.json({ error: { code: "not_found", message: "No such feedback item" } }, { status: 404 });

/**
 * `npm run feedback:addressed` while the desktop app is open (research R9), and nothing else: it
 * answers only the CLI's bearer secret from runtime.json, never the window's session cookie, and
 * doesn't exist in the web app. Same rule as the script: only an open item becomes addressed;
 * nothing is ever resolved, reopened or edited (constitution guard exception, feature 11).
 */
export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const auth = req.headers.get("authorization");
  if (!isDesktop() || !matchesSecret(auth?.startsWith("Bearer ") ? auth.slice(7) : null)) return notFound();
  const id = (await params).id.toLowerCase();
  // markAddressed regenerates the export itself.
  const result = await markAddressed(id);
  if (result === "addressed") return Response.json({ result });
  if (result === "not_open") return Response.json({ result, state: await currentState(id) }, { status: 409 });
  return notFound();
});
