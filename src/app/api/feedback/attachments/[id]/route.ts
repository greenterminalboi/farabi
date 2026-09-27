import { readAttachment } from "@/server/feedback/attachments";
import { withApi } from "@/server/http/withApi";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export const GET = withApi(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const thumb = new URL(req.url).searchParams.get("thumb") === "1";
  const { bytes, mimeType } = await readAttachment(id, thumb);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": mimeType,
      // Files are written once and never change (FR-022, FR-023).
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
});
