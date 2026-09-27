/** A real 1×1 PNG. */
export const PNG_1PX = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
);

/** Bytes that pass the WebP magic-byte check (RIFF....WEBP); enough for storage tests. */
export const WEBP_STUB = Uint8Array.from([
  ...Buffer.from("RIFF"),
  0x1a, 0, 0, 0,
  ...Buffer.from("WEBPVP8 "),
  ...new Array(18).fill(0),
]);

/** Different PNG bytes (the 1×1 PNG plus trailing data), so two attachments differ. */
export function pngVariant(n: number): Uint8Array {
  return Uint8Array.from([...PNG_1PX, ...Buffer.from(`variant-${n}`)]);
}
