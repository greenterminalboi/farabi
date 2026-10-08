import { drillElement } from "@/server/drill/elements";
import { drillResponse, withDrillApi } from "@/server/drill/http";
import { replaceProblem } from "@/server/drill/rounds";
import { db } from "@/server/db/client";

type Ctx = { params: Promise<{ problemId: string }> };

/** A new problem beside a flagged one, on the same rungs and level (FR-014). */
export const POST = withDrillApi(async (_req: Request, { params }: Ctx) => {
  const { problemId } = await params;
  const { drill } = await drillElement(db, problemId, "drill_problem", "Problem");
  await replaceProblem(problemId);
  return drillResponse(drill.id, {}, 201);
});
