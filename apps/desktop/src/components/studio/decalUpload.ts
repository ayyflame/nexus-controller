// Turns an uploaded file into a safe decal image: the real file type is
// checked from its bytes (PNG, JPEG or WebP only; no SVG or other active
// content), its size limited, and it is decoded and re-encoded through a
// canvas so only plain pixels are kept (metadata and anything else dropped).

import { DECAL_LIMITS, LIMITS, fitWithin, isSafeImageDataUrl, sniffImage } from "../../lib/skin";

export async function decalFromFile(file: File): Promise<{ ok: true; image: string } | { ok: false; error: string }> {
  if (file.size > DECAL_LIMITS.fileBytes) return { ok: false, error: `That file is ${(file.size / 1e6).toFixed(1)} MB; the limit is ${DECAL_LIMITS.fileBytes / 1e6} MB.` };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) return { ok: false, error: "Only PNG, JPEG or WebP images can be used." };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: `image/${kind}` }));
  } catch {
    return { ok: false, error: "The image couldn't be read; it may be damaged." };
  }
  if (bitmap.width < DECAL_LIMITS.minSide || bitmap.height < DECAL_LIMITS.minSide) {
    bitmap.close();
    return { ok: false, error: "The image is too small." };
  }
  for (const side of [DECAL_LIMITS.maxSide, 768, 512]) {
    const [w, h] = fitWithin(bitmap.width, bitmap.height, side);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h);
    const image = canvas.toDataURL("image/png");
    if (image.length <= LIMITS.decalChars && isSafeImageDataUrl(image)) { bitmap.close(); return { ok: true, image }; }
  }
  bitmap.close();
  return { ok: false, error: "The image is too detailed to store; try a smaller one." };
}
