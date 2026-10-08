import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { FEEDBACK_MAX_IMAGE_BYTES, FEEDBACK_MAX_IMAGES } from "@/shared/schemas";
import { db } from "../db/client";
import { InvalidRequestError, NotFoundError } from "../errors";
import { assertId } from "../ids";
import { attachmentAbsPath } from "./paths";

export type Upload = { bytes: Uint8Array; name: string | null; thumb: Uint8Array | null };

type ImageType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

const EXT: Record<ImageType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const MAX_THUMB_BYTES = 1024 * 1024;

const startsWith = (b: Uint8Array, bytes: number[], at = 0) => bytes.every((v, i) => b[at + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** The image type from the file's first bytes, not its name or declared type (research R5). */
export function sniffImageType(b: Uint8Array): ImageType | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(b, ascii("GIF8"))) return "image/gif";
  if (startsWith(b, ascii("RIFF")) && startsWith(b, ascii("WEBP"), 8)) return "image/webp";
  return null;
}

export type ValidUpload = Upload & { mimeType: ImageType };

/** Checks count, size and type of every image; drops unusable thumbnails (never an error). */
export function validateUploads(uploads: Upload[]): ValidUpload[] {
  if (uploads.length > FEEDBACK_MAX_IMAGES) {
    throw new InvalidRequestError(`At most ${FEEDBACK_MAX_IMAGES} images per item`);
  }
  return uploads.map((u, i) => {
    const label = u.name ?? `Image ${i + 1}`;
    if (u.bytes.byteLength === 0) throw new InvalidRequestError(`${label} is empty`);
    if (u.bytes.byteLength > FEEDBACK_MAX_IMAGE_BYTES) throw new InvalidRequestError(`${label} is larger than 10 MB`);
    const mimeType = sniffImageType(u.bytes);
    if (!mimeType) throw new InvalidRequestError(`${label} is not a PNG, JPEG, WebP or GIF image`);
    // WebP, or JPEG from engines that can't encode WebP (WebKit; feature 11).
    const thumbType = u.thumb && u.thumb.byteLength > 0 && u.thumb.byteLength <= MAX_THUMB_BYTES ? sniffImageType(u.thumb) : null;
    const thumbOk = thumbType === "image/webp" || thumbType === "image/jpeg";
    return { ...u, thumb: thumbOk ? u.thumb : null, mimeType };
  });
}

export type AttachmentRow = {
  id: string;
  file_path: string;
  thumb_path: string | null;
  original_name: string | null;
  mime_type: ImageType;
  byte_size: number;
  sha256: string;
};

/**
 * Writes an item's images under attachments/<itemId>/ with the 'wx' flag, so an existing file is
 * never overwritten (FR-022). Returns the rows to insert and every path written (for cleanup).
 */
export async function writeAttachmentFiles(
  itemId: string,
  uploads: ValidUpload[],
  written: string[],
): Promise<AttachmentRow[]> {
  if (uploads.length === 0) return [];
  const dir = path.join(/*turbopackIgnore: true*/ "attachments", itemId);
  await fs.mkdir(/*turbopackIgnore: true*/ attachmentAbsPath(dir), { recursive: true });
  const rows: AttachmentRow[] = [];
  for (const u of uploads) {
    const id = randomUUID();
    const filePath = path.join(/*turbopackIgnore: true*/ dir, `${id}.${EXT[u.mimeType]}`).split(path.sep).join("/");
    await fs.writeFile(/*turbopackIgnore: true*/ attachmentAbsPath(filePath), u.bytes, { flag: "wx" });
    written.push(attachmentAbsPath(filePath));
    let thumbPath: string | null = null;
    if (u.thumb) {
      const thumbExt = sniffImageType(u.thumb) === "image/jpeg" ? "jpg" : "webp";
      thumbPath = path.join(/*turbopackIgnore: true*/ dir, `${id}.thumb.${thumbExt}`).split(path.sep).join("/");
      await fs.writeFile(/*turbopackIgnore: true*/ attachmentAbsPath(thumbPath), u.thumb, { flag: "wx" });
      written.push(attachmentAbsPath(thumbPath));
    }
    rows.push({
      id,
      file_path: filePath,
      thumb_path: thumbPath,
      original_name: u.name,
      mime_type: u.mimeType,
      byte_size: u.bytes.byteLength,
      sha256: createHash("sha256").update(u.bytes).digest("hex"),
    });
  }
  return rows;
}

/** Only for files of a create that failed before commit: nothing stored refers to them. */
export async function removeUncommittedFiles(paths: string[]): Promise<void> {
  await Promise.all(paths.map((p) => fs.rm(p, { force: true })));
  // The item's folder was created for this attempt; rmdir only succeeds if it is now empty.
  for (const dir of new Set(paths.map((p) => path.dirname(p)))) await fs.rmdir(dir).catch(() => {});
}

export async function readAttachment(id: string, thumb: boolean): Promise<{ bytes: Buffer; mimeType: string }> {
  assertId(id, "Attachment");
  const row = await db.selectFrom("feedback_attachments").selectAll().where("id", "=", id).executeTakeFirst();
  if (!row) throw new NotFoundError("Attachment not found");
  const useThumb = thumb && row.thumb_path !== null;
  const rel = useThumb ? row.thumb_path! : row.file_path;
  try {
    return { bytes: await fs.readFile(attachmentAbsPath(rel)), mimeType: useThumb ? (rel.endsWith(".jpg") ? "image/jpeg" : "image/webp") : row.mime_type };
  } catch (err) {
    console.error(`Feedback attachment file missing: ${rel}`, err);
    throw new NotFoundError("Attachment file not found");
  }
}
