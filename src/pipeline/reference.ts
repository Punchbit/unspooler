import { toBuffer } from "../media.js";
import { buildReferencePrompt } from "../prompts.js";
import { resolveChromaMode } from "../chroma.js";
import type { AssetConfig, ImageGenerator, StyleConfig, UnspoolerConfig } from "../types.js";

export async function generateReference(opts: {
  config: UnspoolerConfig;
  asset: AssetConfig;
  generator: ImageGenerator;
  takes?: number;
}): Promise<Buffer[]> {
  const { config, asset, generator, takes = 1 } = opts;
  const chroma = resolveChromaMode(asset.chroma ?? config.chroma ?? "auto", config.style.palette);
  const prompt = buildReferencePrompt({
    style: config.style,
    prompt: asset.prompt,
    chroma,
    kind: asset.type,
  });
  const references = await loadRefs(config.style, asset);
  const result = await generator.generate({
    prompt,
    references,
    takes,
    chroma,
    width: 1024,
    height: asset.type === "character" ? 1024 : 1024,
  });
  return result.images;
}

async function loadRefs(style: StyleConfig, asset: AssetConfig): Promise<Buffer[]> {
  const paths = [...(style.references ?? []), ...(asset.references ?? [])];
  return Promise.all(paths.map((p) => toBuffer(p)));
}
