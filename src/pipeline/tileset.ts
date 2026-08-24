import sharp from "sharp";
import { ALPHA_MIN } from "../image.js";

export interface SeamReport {
  ok: boolean;
  horizontal: number;
  vertical: number;
  /** 0 is seamless; higher is more discontinuity. */
  score: number;
  threshold: number;
}

/**
 * Wrap the tile and measure how hard the edges snap. Score is mean squared
 * error across the seam. `ok` when both axes stay under `threshold`.
 */
export async function measureSeams(png: Buffer, threshold = 180): Promise<SeamReport> {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  let hSum = 0;
  let vSum = 0;
  for (let y = 0; y < height; y++) {
    const left = (y * width) * 4;
    const right = (y * width + (width - 1)) * 4;
    hSum += pixelDist(data, left, right);
  }
  for (let x = 0; x < width; x++) {
    const top = x * 4;
    const bot = ((height - 1) * width + x) * 4;
    vSum += pixelDist(data, top, bot);
  }
  const horizontal = hSum / height;
  const vertical = vSum / width;
  const score = (horizontal + vertical) / 2;
  return {
    ok: score <= threshold,
    horizontal,
    vertical,
    score,
    threshold,
  };
}

function pixelDist(data: Buffer, a: number, b: number): number {
  if (data[a + 3]! < ALPHA_MIN && data[b + 3]! < ALPHA_MIN) return 0;
  const dr = data[a]! - data[b]!;
  const dg = data[a + 1]! - data[b + 1]!;
  const db = data[a + 2]! - data[b + 2]!;
  return dr * dr + dg * dg + db * db;
}

export async function sliceTiles(
  png: Buffer,
  grid: { cols: number; rows: number },
): Promise<Buffer[]> {
  const meta = await sharp(png).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const tw = Math.floor(width / grid.cols);
  const th = Math.floor(height / grid.rows);
  const tiles: Buffer[] = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      tiles.push(
        await sharp(png)
          .extract({ left: c * tw, top: r * th, width: tw, height: th })
          .png()
          .toBuffer(),
      );
    }
  }
  return tiles;
}
