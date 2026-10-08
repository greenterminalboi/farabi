import { verifyApiKey } from "@/server/ai/verifyKey";
import { deleteCredential, getCredential, setCredential } from "@/server/host/bridge";
import { registerSecret } from "@/server/host/redact";
import { readJson, withApi } from "@/server/http/withApi";
import { SaveApiKeyBody } from "@/shared/desktop";

// The Claude API key lives in the OS credential store (feature 11, FR-013). It is never returned,
// logged or written to the store; only whether one is saved.
export const GET = withApi(async () => Response.json({ present: (await getCredential({ reveal: false })).present }));

/** Saves the key, or removes it with `{ value: null }` (no DELETE handlers: Article II's guard). */
export const PUT = withApi(async (req: Request) => {
  const { value } = await readJson(req, SaveApiKeyBody);
  if (value === null) {
    await deleteCredential();
    return new Response(null, { status: 204 });
  }
  registerSecret(value);
  if (new URL(req.url).searchParams.get("verify") === "1" && !(await verifyApiKey(value))) {
    return Response.json({ error: { code: "key_rejected", message: "The Claude API didn't accept this key." } }, { status: 422 });
  }
  await setCredential(value);
  return new Response(null, { status: 204 });
});
