import { InvalidRequestError } from "@/server/errors";
import type { Upload } from "@/server/feedback/attachments";
import { createFeedback } from "@/server/feedback/create";
import { listFeedback } from "@/server/feedback/list";
import { withApi } from "@/server/http/withApi";
import type { FeedbackCreateFields } from "@/shared/schemas";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => Response.json({ items: await listFeedback() }));

function field(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
}

function parseTags(raw: string | undefined): unknown {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    throw new InvalidRequestError("tags must be a JSON array of strings");
  }
}

/** Multipart: text, view, projectId?, elementId?, tags? (JSON), image* with a matching thumb* each (research R5). */
export const POST = withApi(async (req: Request) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new InvalidRequestError("Body must be multipart/form-data");
  }
  const images = form.getAll("image").filter((v): v is File => v instanceof File);
  const thumbs = form.getAll("thumb");
  const uploads: Upload[] = await Promise.all(
    images.map(async (image, i) => {
      const thumb = thumbs[i];
      return {
        bytes: new Uint8Array(await image.arrayBuffer()),
        name: image.name || null,
        thumb: thumb instanceof File && thumb.size > 0 ? new Uint8Array(await thumb.arrayBuffer()) : null,
      };
    }),
  );
  // Raw form values; createFeedback validates them with FeedbackCreateFields.
  const fields = {
    text: field(form, "text") ?? "",
    view: field(form, "view"),
    projectId: field(form, "projectId") || null,
    elementId: field(form, "elementId") || null,
    tags: parseTags(field(form, "tags")),
  } as FeedbackCreateFields;
  const item = await createFeedback(fields, uploads);
  return Response.json({ item }, { status: 201 });
});
