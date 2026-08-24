import { buildMotionPrompt } from "../prompts.js";
import { resolveChromaMode } from "../chroma.js";
import type {
  AssetConfig,
  Direction,
  ResolvedAnimation,
  UnspoolerConfig,
  VideoGenerator,
} from "../types.js";

export async function generateVideo(opts: {
  config: UnspoolerConfig;
  asset: AssetConfig;
  animation: ResolvedAnimation;
  direction: Direction;
  image: Buffer;
  generator: VideoGenerator;
}): Promise<Buffer> {
  const { config, asset, animation, direction, image, generator } = opts;
  const chroma = resolveChromaMode(asset.chroma ?? config.chroma ?? "auto", config.style.palette);
  const prompt = buildMotionPrompt({
    style: config.style,
    assetPrompt: asset.prompt,
    animation: animation.name,
    animationPrompt: animation.prompt || undefined,
    direction,
    chroma,
  });
  const result = await generator.generate({
    prompt,
    image,
    duration: animation.duration,
    chroma,
  });
  return result.video;
}
