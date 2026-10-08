import { providerReady } from "@/server/ai";
import { z } from "zod";
import { readJson } from "@/server/http/withApi";
import { drillResponse, withDrillApi } from "@/server/drill/http";
import { finishRound } from "@/server/drill/rounds";

type Ctx = { params: Promise<{ roundId: string }> };

const EndBody = z.object({ by: z.enum(["all_answered", "user"]) });

/** Ends a round: level changes, the offer if now complete, then the next round (FR-019, FR-022). */
export const POST = withDrillApi(async (req: Request, { params }: Ctx) => {
  await providerReady();
  const { roundId } = await params;
  const { by } = await readJson(req, EndBody);
  const { drillId, nextRoundError } = await finishRound(roundId, by);
  return drillResponse(drillId, nextRoundError ? { nextRoundError } : {});
});
