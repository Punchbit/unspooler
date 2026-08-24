import sharp from "sharp";
import { ALPHA_MIN, contentBounds, toRaw } from "../image.js";
import type { PartName, SkeletonSpec } from "../rig/types.js";
import type { BackgroundRemover, ChromaMode, HexColor } from "../types.js";
import { matteFrames } from "./matte.js";

export interface SegmentOptions {
  skeleton: SkeletonSpec;
  remover: BackgroundRemover;
  chroma?: ChromaMode;
  palette?: HexColor[];
}

export type SegmentedParts = Map<PartName, Buffer>;

/**
 * Cut a generated parts sheet into named part images.
 *
 * The sheet was prompted onto a strict grid (skeleton.sheetLayout), so the
 * primary strategy is deterministic: matte the background away, slice the
 * grid, and keep the largest connected blob inside each cell (which drops
 * specks and any bleed from neighboring cells).
 */
export async function segmentParts(sheet: Buffer, options: SegmentOptions): Promise<SegmentedParts> {
  const { skeleton } = options;
  const [matted] = await matteFrames([sheet], {
    remover: options.remover,
    chroma: options.chroma,
    palette: options.palette,
    temporalSmooth: false,
  });

  const meta = await sharp(matted!).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const { cols, rows, order } = skeleton.sheetLayout;
  const cellW = Math.floor(width / cols);
  const cellH = Math.floor(height / rows);
  if (cellW < 8 || cellH < 8) {
    throw new Error(`Parts sheet is too small to slice (${width}x${height})`);
  }

  const parts: SegmentedParts = new Map();
  const missing: PartName[] = [];

  for (let i = 0; i < order.length; i++) {
    const part = order[i]! as PartName;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cell = await sharp(matted!)
      .extract({ left: col * cellW, top: row * cellH, width: cellW, height: cellH })
      .png()
      .toBuffer();
    const isolated = await isolateLargestBlob(cell);
    if (!isolated) {
      missing.push(part);
      continue;
    }
    parts.set(part, isolated);
  }

  if (missing.length) {
    throw new Error(
      `Parts sheet segmentation found no content for: ${missing.join(", ")}. ` +
        `Re-roll the parts sheet (unspooler build) or check the chroma backdrop.`,
    );
  }
  return parts;
}

/**
 * Keep only the largest 4-connected opaque blob in the image and trim to it.
 * Returns null when the image has no meaningful content.
 */
export async function isolateLargestBlob(png: Buffer, alphaMin = ALPHA_MIN): Promise<Buffer | null> {
  const raw = await toRaw(png);
  const { width, height, data } = raw;
  const labels = new Int32Array(width * height).fill(-1);
  let best = { label: -1, size: 0 };
  let nextLabel = 0;

  const stack: number[] = [];
  for (let start = 0; start < width * height; start++) {
    if (labels[start] !== -1 || data[start * 4 + 3]! <= alphaMin) continue;
    const label = nextLabel++;
    let size = 0;
    stack.push(start);
    labels[start] = label;
    while (stack.length) {
      const idx = stack.pop()!;
      size++;
      const x = idx % width;
      const y = (idx / width) | 0;
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ] as const) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const nIdx = ny * width + nx;
        if (labels[nIdx] === -1 && data[nIdx * 4 + 3]! > alphaMin) {
          labels[nIdx] = label;
          stack.push(nIdx);
        }
      }
    }
    if (size > best.size) best = { label, size };
  }

  // Ignore anything smaller than a speck.
  if (best.size < 16) return null;

  const cleaned = Buffer.from(data);
  for (let i = 0; i < width * height; i++) {
    if (labels[i] !== best.label) {
      cleaned[i * 4] = 0;
      cleaned[i * 4 + 1] = 0;
      cleaned[i * 4 + 2] = 0;
      cleaned[i * 4 + 3] = 0;
    }
  }

  const bounds = contentBounds({ data: cleaned, width, height }, alphaMin);
  if (!bounds) return null;
  return sharp(cleaned, { raw: { width, height, channels: 4 } })
    .extract({
      left: bounds.minX,
      top: bounds.minY,
      width: bounds.maxX - bounds.minX + 1,
      height: bounds.maxY - bounds.minY + 1,
    })
    .png()
    .toBuffer();
}
