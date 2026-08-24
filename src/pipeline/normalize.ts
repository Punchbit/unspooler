import sharp from "sharp";
import { ALPHA_MIN, contentBounds, toRaw, type RawImage } from "../image.js";
import { parseHex } from "../chroma.js";
import type { AssetType, HexColor } from "../types.js";

export type AnchorMode = "feet" | "centroid" | "none";

export function anchorModeFor(type: AssetType): AnchorMode {
  if (type === "character") return "feet";
  if (type === "vfx") return "centroid";
  return "none";
}

export interface NormalizeOptions {
  cell: { w: number; h: number };
  mode: AnchorMode;
  pixelNative?: number;
  palette?: HexColor[];
  padding?: number;
}

export interface NormalizedFrame {
  png: Buffer;
  anchor: { x: number; y: number };
}

/**
 * Trim, share one baseline/center across a clip, drop into a uniform cell,
 * optionally snap to a pixel grid + palette.
 */
export async function normalizeFrames(
  frames: Buffer[],
  options: NormalizeOptions,
): Promise<NormalizedFrame[]> {
  const raws = await Promise.all(frames.map(toRaw));
  const pad = options.padding ?? 4;
  const boxes = raws.map((raw) => contentBounds(raw));
  const cellW = options.cell.w;
  const cellH = options.cell.h;

  const placed: NormalizedFrame[] = [];
  for (let i = 0; i < raws.length; i++) {
    const raw = raws[i]!;
    const box = boxes[i];
    let png = await placeInCell(raw, box, cellW, cellH, options.mode, pad);
    if (options.pixelNative) {
      png = await pixelSnap(png, options.pixelNative, options.palette);
    }
    const anchor =
      options.mode === "feet"
        ? { x: cellW / 2, y: cellH - pad }
        : options.mode === "centroid"
          ? { x: cellW / 2, y: cellH / 2 }
          : { x: cellW / 2, y: cellH / 2 };
    placed.push({ png, anchor });
  }
  return placed;
}

async function placeInCell(
  raw: RawImage,
  box: { minX: number; minY: number; maxX: number; maxY: number } | null,
  cellW: number,
  cellH: number,
  mode: AnchorMode,
  pad: number,
): Promise<Buffer> {
  const canvas = await sharp({
    create: { width: cellW, height: cellH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
  if (!box) return canvas;

  let w = box.maxX - box.minX + 1;
  let h = box.maxY - box.minY + 1;
  const maxW = cellW - pad * 2;
  const maxH = cellH - pad * 2;
  let sprite = await sharp(raw.data, {
    raw: { width: raw.width, height: raw.height, channels: 4 },
  })
    .extract({ left: box.minX, top: box.minY, width: w, height: h })
    .png()
    .toBuffer();
  if (w > maxW || h > maxH) {
    const scale = Math.min(maxW / w, maxH / h);
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    sprite = await sharp(sprite)
      .resize(w, h, { fit: "inside" })
      .png()
      .toBuffer();
  }

  let left = Math.round((cellW - w) / 2);
  let top = Math.round((cellH - h) / 2);
  if (mode === "feet") {
    top = Math.max(0, cellH - pad - h);
    left = Math.max(0, Math.round(cellW / 2 - w / 2));
  } else if (mode === "centroid") {
    left = Math.max(0, Math.round(cellW / 2 - w / 2));
    top = Math.max(0, Math.round(cellH / 2 - h / 2));
  }
  return sharp(canvas)
    .composite([{ input: sprite, left, top }])
    .png()
    .toBuffer();
}

/**
 * Snap to a native pixel grid and optionally quantize to the project palette.
 * Inspired by the Sprite Fusion pixel-snapper approach.
 */
export async function pixelSnap(
  png: Buffer,
  native: number,
  palette?: HexColor[],
): Promise<Buffer> {
  const meta = await sharp(png).metadata();
  const width = meta.width ?? native;
  const height = meta.height ?? native;
  const targetW = Math.max(native, Math.round(width / native) * native);
  const targetH = Math.max(native, Math.round(height / native) * native);
  const smallW = Math.max(1, Math.round(targetW / (targetW / native)));
  const smallH = Math.max(1, Math.round(targetH / (targetH / native)));

  let img = sharp(png)
    .resize(smallW, smallH, { kernel: sharp.kernel.nearest, fit: "fill" })
    .resize(targetW, targetH, { kernel: sharp.kernel.nearest, fit: "fill" });

  if (palette?.length) {
    const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const colors = palette.map(parseHex);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < ALPHA_MIN) {
        data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
        continue;
      }
      const nearest = nearestColor(data[i]!, data[i + 1]!, data[i + 2]!, colors);
      data[i] = nearest.r;
      data[i + 1] = nearest.g;
      data[i + 2] = nearest.b;
    }
    return sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .png()
      .toBuffer();
  }

  return img.png().toBuffer();
}

function nearestColor(
  r: number,
  g: number,
  b: number,
  palette: Array<{ r: number; g: number; b: number }>,
): { r: number; g: number; b: number } {
  let best = palette[0]!;
  let bestD = Infinity;
  for (const c of palette) {
    const d = (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}
