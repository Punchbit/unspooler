import sharp from "sharp";
import { keyFrame } from "../providers/chroma.js";
import { resolveChromaMode } from "../chroma.js";
import { isChromaPixel } from "../chroma.js";
import type { BackgroundRemover, ChromaMode, HexColor } from "../types.js";

export interface MatteOptions {
  remover: BackgroundRemover;
  chroma?: ChromaMode;
  palette?: HexColor[];
  variant?: string;
  /** Combine AI matte with a chroma prior so leftover green/magenta dies. */
  chromaPrior?: boolean;
  temporalSmooth?: boolean;
}

export async function matteFrames(frames: Buffer[], options: MatteOptions): Promise<Buffer[]> {
  const mode = resolveChromaMode(options.chroma ?? "auto", options.palette);
  const result = await options.remover.remove({
    frames,
    chroma: mode,
    variant: options.variant,
  });
  let out = result.frames;
  if (options.chromaPrior !== false && !options.remover.id.startsWith("chroma:")) {
    out = await Promise.all(out.map((frame) => applyChromaPrior(frame, mode)));
  }
  if (options.temporalSmooth !== false && out.length >= 3) {
    out = await smoothMattes(out);
  }
  return out;
}

async function applyChromaPrior(png: Buffer, mode: "green" | "magenta"): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const keyed = await keyFrame(png, mode);
  const prior = await sharp(keyed).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!,
      g = data[i + 1]!,
      b = data[i + 2]!;
    if (isChromaPixel(r, g, b, mode) || prior.data[i + 3]! === 0) {
      data[i + 3] = Math.min(data[i + 3]!, prior.data[i + 3]!);
    }
  }
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

/** Median-filter alpha across adjacent frames to kill BiRefNet shimmer. */
export async function smoothMattes(frames: Buffer[]): Promise<Buffer[]> {
  const raws = await Promise.all(
    frames.map((f) => sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true })),
  );
  const width = raws[0]!.info.width;
  const height = raws[0]!.info.height;
  const out: Buffer[] = [];
  for (let i = 0; i < raws.length; i++) {
    const prev = raws[Math.max(0, i - 1)]!.data;
    const curr = raws[i]!.data;
    const next = raws[Math.min(raws.length - 1, i + 1)]!.data;
    const dest = Buffer.from(curr);
    for (let p = 3; p < dest.length; p += 4) {
      dest[p] = median3(prev[p]!, curr[p]!, next[p]!);
    }
    out.push(
      await sharp(dest, { raw: { width, height, channels: 4 } })
        .png()
        .toBuffer(),
    );
  }
  return out;
}

function median3(a: number, b: number, c: number): number {
  if (a > b) [a, b] = [b, a];
  if (b > c) [b, c] = [c, b];
  if (a > b) [a, b] = [b, a];
  return b;
}
