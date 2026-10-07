const THUMB_EDGE = 320;

/**
 * A small preview made in the browser, so the panel stays light (research R5): WebP, or JPEG where
 * the engine can't encode WebP (WebKit, so the macOS desktop app; feature 11).
 */
export async function makeThumbnail(file: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, THUMB_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const encode = (type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    const webp = await encode("image/webp", 0.8);
    if (webp?.type === "image/webp") return webp;
    const jpeg = await encode("image/jpeg", 0.85);
    return jpeg?.type === "image/jpeg" ? jpeg : null;
  } catch {
    return null;
  }
}
