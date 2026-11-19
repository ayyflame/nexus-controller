// TEST-ONLY: decodes the model's PNG textures in node (zlib + PNG filters),
// so tests can check zone rules against the real paint regions.
import { inflateSync } from "node:zlib";

export function decodePng(buf: Buffer): { width: number; height: number; channels: number; data: Uint8Array } {
  let off = 8;
  let width = 0, height = 0, channels = 0, palette: Buffer | null = null;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      const depth = body[8]!, colorType = body[9]!, interlace = body[12]!;
      if (depth !== 8 || interlace !== 0) throw new Error("unsupported PNG");
      channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType]!;
    } else if (type === "PLTE") palette = Buffer.from(body);
    else if (type === "IDAT") idat.push(Buffer.from(body));
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + x]! : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels]! : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      out[y * stride + x] = (line[x]! + pred) & 255;
    }
  }
  if (palette) {
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) for (let k = 0; k < 3; k++) rgb[i * 3 + k] = palette[out[i]! * 3 + k]!;
    return { width, height, channels: 3, data: rgb };
  }
  return { width, height, channels, data: out };
}
