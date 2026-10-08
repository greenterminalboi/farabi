import { drillResponse, withDrillApi } from "@/server/drill/http";
import { dismissOffer } from "@/server/drill/offers";

type Ctx = { params: Promise<{ offerId: string }> };

/** Hides the completion offer for good (FR-032). */
export const POST = withDrillApi(async (_req: Request, { params }: Ctx) => {
  const { offerId } = await params;
  return drillResponse(await dismissOffer(offerId));
});
