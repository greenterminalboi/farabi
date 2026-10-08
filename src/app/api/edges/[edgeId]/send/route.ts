import { SendRequest } from "@/shared/schemas";
import { sendUnsent } from "@/server/graph/ask";
import { readJson, withApi } from "@/server/http/withApi";
import { maybeWait } from "@/server/http/wait";

type Ctx = { params: Promise<{ edgeId: string }> };

/** Sends an unsent edge once (409 already_sent). */
export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const { edgeId } = await params;
  const { content, terms } = await readJson(req, SendRequest);
  return Response.json(await maybeWait(req, await sendUnsent(edgeId, content, terms)), { status: 201 });
});
