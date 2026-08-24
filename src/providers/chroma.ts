import sharp from "sharp";
import { defringeRaw, despeckleRaw, keyChromaRaw, resolveChromaMode } from "../chroma.js";
import type { BackgroundRemover, CostEstimate, MatteInput, MatteResult } from "../types.js";

export interface ChromaKeyOptions {
  color?: "green" | "magenta" | "auto";
}

/**
 * Offline matting. Good enough as a fallback and as a chroma prior, but it
 * will always leave some fringe on real video — prefer BiRefNet when you can.
 */
export function chromaKey(options: ChromaKeyOptions = {}): BackgroundRemover {
  const color = options.color ?? "auto";
  return {
    kind: "matte",
    id: `chroma:${color}`,
    estimate(input: MatteInput): CostEstimate {
      return { usd: 0, unit: `${input.frames.length} frame(s)`, notes: "offline chroma key" };
    },
    async remove(input: MatteInput): Promise<MatteResult> {
      const mode = resolveChromaMode(input.chroma ?? color);
      const frames: Buffer[] = [];
      for (const frame of input.frames) {
        frames.push(await keyFrame(frame, mode));
      }
      return { frames, model: `chroma:${mode}` };
    },
  };
}

export async function keyFrame(
  png: Buffer,
  mode: "green" | "magenta",
): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  keyChromaRaw(data, mode);
  despeckleRaw(data, info.width, info.height);
  defringeRaw(data, info.width, info.height, mode);
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}
