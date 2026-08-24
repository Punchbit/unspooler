import { resolveChromaMode } from "../chroma.js";
import { buildPartsSheetPrompt } from "../prompts.js";
import type { Facing, SkeletonSpec } from "../rig/types.js";
import type { AssetConfig, ImageGenerator, UnspoolerConfig } from "../types.js";

/**
 * Generate the body-parts sheet for one facing: the reference character
 * disassembled onto a strict grid on a chroma backdrop. The reference image
 * is always passed so the model copies identity instead of inventing one.
 */
export async function generatePartsSheet(opts: {
  config: UnspoolerConfig;
  asset: AssetConfig;
  skeleton: SkeletonSpec;
  facing: Facing;
  reference: Buffer;
  generator: ImageGenerator;
}): Promise<Buffer> {
  const { config, asset, skeleton, facing, reference, generator } = opts;
  const chroma = resolveChromaMode(asset.chroma ?? config.chroma ?? "auto", config.style.palette);
  const prompt = buildPartsSheetPrompt({
    style: config.style,
    prompt: asset.prompt,
    facing,
    chroma,
    layout: skeleton.sheetLayout,
  });
  const result = await generator.generate({
    prompt,
    references: [reference],
    chroma,
    takes: 1,
    width: 1024,
    height: 1024,
  });
  const image = result.images[0];
  if (!image) throw new Error(`Parts sheet generation returned no image for ${asset.id}/${facing}`);
  return image;
}
