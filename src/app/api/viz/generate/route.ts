// Scene generation from text (feature 014, contracts/http-api.md). Writes nothing in any case.
import { z } from "zod";
import { providerReady } from "@/server/ai";
import { isAbortError } from "@/server/ai/provider";
import { InvalidRequestError } from "@/server/errors";
import { readJson, withApi } from "@/server/http/withApi";
import { generateScene, installVizFakes, VIZ_FAMILIES, VizGenerationError, validateInput } from "@/server/viz";
import { isReplyModelChoice } from "@/shared/models";

export const dynamic = "force-dynamic";

const Body = z.object({
  text: z.string(),
  family: z.enum(VIZ_FAMILIES as [string, ...string[]]).optional(),
  model: z.string().optional(),
});

export const POST = withApi(async (req: Request) => {
  const body = await readJson(req, Body);
  const input = validateInput({ text: body.text, family: body.family as (typeof VIZ_FAMILIES)[number] | undefined });
  if (body.model !== undefined && !isReplyModelChoice(body.model)) throw new InvalidRequestError(`Unknown model "${body.model}"`);
  const model = body.model && body.model !== "default" ? body.model : null;
  await providerReady();
  installVizFakes();
  try {
    const scene = await generateScene(input, { model, signal: req.signal });
    return Response.json({ scene });
  } catch (err) {
    if (err instanceof VizGenerationError) {
      return Response.json({ error: { code: err.code, message: err.message } }, { status: 503 });
    }
    // The page cancelled (Generate pressed again, or closed): nobody is waiting for an answer.
    if (isAbortError(err)) return new Response(null, { status: 499 });
    throw err;
  }
});
