import { z } from "zod";
import { db } from "@/server/db/client";
import { seedAndConvertV1 } from "@/server/db/v1/testFixture";
import { readJson, withApi } from "@/server/http/withApi";

const Body = z.object({ projectId: z.string().uuid() });

/** Test only (T073): seeds a small v1 project and converts it, as migration 0010 would. */
export const POST = withApi(async (req: Request) => {
  if (process.env.FARABI_TEST_HOOKS !== "1") return new Response(null, { status: 404 });
  const { projectId } = await readJson(req, Body);
  return Response.json(await seedAndConvertV1(db, projectId), { status: 201 });
});
