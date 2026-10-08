// Drills (Feature 12, contracts/http-api.md). Every change is a POST that inserts rows; there is
// no DELETE or PATCH (Article II).
import { providerReady } from "@/server/ai";
import { CreateDrillBody } from "@/shared/schemas";
import { readJson } from "@/server/http/withApi";
import { assertId } from "@/server/ids";
import { createDrill } from "@/server/drill/create";
import { drillResponse, withDrillApi } from "@/server/drill/http";
import { loadDrillSummaries } from "@/server/drill/load";
import { InvalidRequestError } from "@/server/errors";

export const dynamic = "force-dynamic";

/** The canvas cards of a project's drills (FR-024). */
export const GET = withDrillApi(async (req: Request) => {
  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) throw new InvalidRequestError("projectId is required");
  return Response.json({ drills: await loadDrillSummaries(assertId(projectId, "Project")) });
});

/** Creates a drill: the AI proposes a ladder first; a 503 writes nothing (Story 1 AS4). */
export const POST = withDrillApi(async (req: Request) => {
  await providerReady();
  const body = await readJson(req, CreateDrillBody);
  return drillResponse(await createDrill(body), {}, 201);
});
