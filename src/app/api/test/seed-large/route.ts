import { z } from "zod";
import { db } from "@/server/db/client";
import { readJson, withApi } from "@/server/http/withApi";
import { testHooksEnabled } from "@/server/testing/hooks";
import { seedLarge } from "@/server/testing/seedLarge";

const Body = z.object({ elements: z.number().int().min(1).max(20000).optional(), feedback: z.number().int().min(0).max(500).optional() });

/** e2e: the scale seed in the running app (FARABI_TEST_HOOKS=1 only). */
export const POST = withApi(async (req: Request) => {
  if (!testHooksEnabled()) return new Response(null, { status: 404 });
  return Response.json({ summary: await seedLarge(db, await readJson(req, Body)) });
});
