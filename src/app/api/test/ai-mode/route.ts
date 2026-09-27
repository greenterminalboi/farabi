import { z } from "zod";
import { setFakeMode } from "@/server/ai/fake";
import { readJson, withApi } from "@/server/http/withApi";

const Body = z.object({
  mode: z.enum(["ok", "fail", "slow"]),
  delayMs: z.number().int().min(0).optional(),
});

function enabled(): boolean {
  const testing = process.env.NODE_ENV !== "production" || process.env.FARABI_TEST_HOOKS === "1";
  return testing && (process.env.AI_PROVIDER ?? "fake") === "fake";
}

export const POST = withApi(async (req: Request) => {
  if (!enabled()) return new Response(null, { status: 404 });
  setFakeMode(await readJson(req, Body));
  return Response.json({ ok: true });
});
