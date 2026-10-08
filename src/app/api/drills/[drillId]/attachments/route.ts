import { AttachmentBody } from "@/shared/schemas";
import { readJson } from "@/server/http/withApi";
import { setAttachment } from "@/server/drill/attachments";
import { drillResponse, withDrillApi } from "@/server/drill/http";

type Ctx = { params: Promise<{ drillId: string }> };

/** Attaches or detaches a conversation (FR-031). Never calls the AI (FR-027). */
export const POST = withDrillApi(async (req: Request, { params }: Ctx) => {
  const { drillId } = await params;
  const { nodeId, action } = await readJson(req, AttachmentBody);
  await setAttachment(drillId, nodeId, action);
  return drillResponse(drillId);
});
