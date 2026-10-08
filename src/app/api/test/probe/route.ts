import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { readJson, withApi } from "@/server/http/withApi";

// Feature 11 gate G1: the probe injected into the real desktop window (debug builds only) reports
// its measurements here, because nothing can drive or read a WKWebView from outside.
const Body = z.object({ name: z.string().regex(/^[a-z0-9-]{1,40}$/), data: z.unknown() });

function enabled(): boolean {
  const testing = process.env.NODE_ENV !== "production" || process.env.FARABI_TEST_HOOKS === "1";
  return testing && process.env.FARABI_HOST === "tauri" && Boolean(process.env.FARABI_DATA_DIR);
}

export const POST = withApi(async (req: Request) => {
  if (!enabled()) return new Response(null, { status: 404 });
  const { name, data } = await readJson(req, Body);
  const dir = path.join(/*turbopackIgnore: true*/ process.env.FARABI_DATA_DIR!, "probe");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(/*turbopackIgnore: true*/ dir, `${name}.json`), JSON.stringify({ at: new Date().toISOString(), data }, null, 2));
  return Response.json({ ok: true });
});
