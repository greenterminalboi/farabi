import { withApi } from "@/server/http/withApi";
import { resetStore, testHooksEnabled } from "@/server/testing/hooks";

/** e2e: an empty store before each test (FARABI_TEST_HOOKS=1 only). */
export const POST = withApi(async () => {
  if (!testHooksEnabled()) return new Response(null, { status: 404 });
  await resetStore();
  return Response.json({ ok: true });
});
