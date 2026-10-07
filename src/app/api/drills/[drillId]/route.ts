import { drillResponse, withDrillApi } from "@/server/drill/http";

type Ctx = { params: Promise<{ drillId: string }> };

export const dynamic = "force-dynamic";

/** The whole drill; 404 when it or its project is trashed (FR-029). */
export const GET = withDrillApi(async (_req: Request, { params }: Ctx) => drillResponse((await params).drillId));
