// Removes the plain light background around a dark object in a photo, for
// display only (the user's file is not changed).
//
// Light pixels connected to the image border are background. Each becomes
// black with an opacity from its darkness: pure white disappears, the
// anti-aliased edge of a dark object and a soft drop shadow keep their exact
// darkness as transparency, so edges stay smooth on a dark page without a
// white halo. Light areas enclosed by the object (reflections) are kept.

/** Background pixels must be at least this light (0–255) to be removed. */
export const LIGHT_THRESHOLD = 150;
/** Edge pixels next to the removed background (JPEG fringe) this light or
 *  lighter are blended too; the dark object itself is well below this. */
export const EDGE_THRESHOLD = 60;
/** How many pixels deep the edge pass reaches into the object's outline. */
export const EDGE_PASSES = 3;

function lum(d: Uint8ClampedArray, i: number): number {
  return 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
}

/** Edits RGBA pixels in place; returns how many pixels were changed. */
export function removeLightBackground(data: Uint8ClampedArray, width: number, height: number, threshold = LIGHT_THRESHOLD): number {
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (seen[p]) return;
    seen[p] = 1;
    if (lum(data, p * 4) >= threshold) stack.push(p);
  };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }
  let changed = 0;
  while (stack.length) {
    const p = stack.pop()!;
    const i = p * 4;
    const darkness = 1 - lum(data, i) / 255; // 0 = white
    data[i] = 0; data[i + 1] = 0; data[i + 2] = 0;
    data[i + 3] = Math.round(Math.min(1, darkness) * data[i + 3]!);
    changed++;
    const x = p % width, y = (p - x) / width;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  // Compression leaves mid-grey speckles along the outline that are darker
  // than the background threshold but much lighter than the object. Blend
  // the ones touching the removed background the same way, a few pixels deep.
  const removed = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) {
    if (seen[p] && data[p * 4] === 0 && data[p * 4 + 1] === 0 && data[p * 4 + 2] === 0 && data[p * 4 + 3]! < 255) removed[p] = 1;
  }
  for (let pass = 0; pass < EDGE_PASSES; pass++) {
    const next: number[] = [];
    for (let p = 0; p < width * height; p++) {
      if (removed[p] || lum(data, p * 4) < EDGE_THRESHOLD) continue;
      const x = p % width, y = (p - x) / width;
      const touches = (x > 0 && removed[p - 1]) || (x < width - 1 && removed[p + 1]) ||
        (y > 0 && removed[p - width]) || (y < height - 1 && removed[p + width]);
      if (touches) next.push(p);
    }
    for (const p of next) {
      const i = p * 4;
      const darkness = 1 - lum(data, i) / 255;
      data[i] = 0; data[i + 1] = 0; data[i + 2] = 0;
      data[i + 3] = Math.round(darkness * data[i + 3]!);
      removed[p] = 1;
      changed++;
    }
  }
  return changed;
}

/** Browser only: the image at `src` with its background removed, as a PNG data URL. */
export async function cutOutBackground(src: string): Promise<string> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return src;
  ctx.drawImage(img, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  removeLightBackground(pixels.data, canvas.width, canvas.height);
  ctx.putImageData(pixels, 0, 0);
  return canvas.toDataURL("image/png");
}
