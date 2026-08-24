import sharp from "sharp";

export const ALPHA_MIN = 32;

export interface RawImage {
  data: Buffer;
  width: number;
  height: number;
}

export async function toRaw(png: Buffer): Promise<RawImage> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export async function fromRaw(raw: RawImage): Promise<Buffer> {
  return sharp(raw.data, {
    raw: { width: raw.width, height: raw.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function contentBounds(raw: RawImage, alphaMin = ALPHA_MIN): Bounds | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -1,
    maxY = -1;
  const { data, width, height } = raw;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! > alphaMin) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY };
}

export function centroid(raw: RawImage, alphaMin = ALPHA_MIN): { x: number; y: number } | null {
  let sx = 0,
    sy = 0,
    n = 0;
  const { data, width, height } = raw;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! > alphaMin) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  if (!n) return null;
  return { x: sx / n, y: sy / n };
}

export function footBaseline(raw: RawImage, alphaMin = ALPHA_MIN): number | null {
  const bounds = contentBounds(raw, alphaMin);
  return bounds ? bounds.maxY : null;
}

export async function alphaTrim(png: Buffer, padding = 0): Promise<Buffer> {
  const raw = await toRaw(png);
  const bounds = contentBounds(raw);
  if (!bounds) return png;
  const left = Math.max(0, bounds.minX - padding);
  const top = Math.max(0, bounds.minY - padding);
  const width = Math.min(raw.width - left, bounds.maxX - bounds.minX + 1 + padding * 2);
  const height = Math.min(raw.height - top, bounds.maxY - bounds.minY + 1 + padding * 2);
  return sharp(png).ensureAlpha().extract({ left, top, width, height }).png().toBuffer();
}

/** Downscale-compare two frames. Lower is more similar. */
export async function frameDistance(a: Buffer, b: Buffer, size = 32): Promise<number> {
  const [ra, rb] = await Promise.all([
    sharp(a).resize(size, size, { fit: "fill" }).removeAlpha().raw().toBuffer(),
    sharp(b).resize(size, size, { fit: "fill" }).removeAlpha().raw().toBuffer(),
  ]);
  let sum = 0;
  for (let i = 0; i < ra.length; i++) {
    const d = ra[i]! - rb[i]!;
    sum += d * d;
  }
  return sum / ra.length;
}

export async function flipHorizontal(png: Buffer): Promise<Buffer> {
  return sharp(png).flop().png().toBuffer();
}
