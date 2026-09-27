import { CaptureRequest } from "@/shared/schemas";
import { captureDefinition } from "@/server/definitions/capture";
import { listDefinitions, termIndex } from "@/server/definitions/list";
import { readJson, withApi } from "@/server/http/withApi";

export const dynamic = "force-dynamic";

export const POST = withApi(async (req: Request) => {
  const result = await captureDefinition(await readJson(req, CaptureRequest));
  return Response.json(result, { status: result.created ? 201 : 200 });
});

export const GET = withApi(async (req: Request) => {
  if (new URL(req.url).searchParams.get("index") === "1") return Response.json({ terms: await termIndex() });
  return Response.json({ definitions: await listDefinitions() });
});
