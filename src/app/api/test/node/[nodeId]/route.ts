import { db } from "@/server/db/client";
import { withApi } from "@/server/http/withApi";
import { testHooksEnabled } from "@/server/testing/hooks";

type Ctx = { params: Promise<{ nodeId: string }> };

/** e2e: a node's stored text and properties, as written (FARABI_TEST_HOOKS=1 only). */
export const GET = withApi(async (_req: Request, { params }: Ctx) => {
  if (!testHooksEnabled()) return new Response(null, { status: 404 });
  const row = await db.selectFrom("nodes").select(["text", "properties"]).where("id", "=", (await params).nodeId).executeTakeFirst();
  return row ? Response.json(row) : new Response(null, { status: 404 });
});
