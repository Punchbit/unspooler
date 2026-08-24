import { modelForPreset, PREFERRED_MODELS } from "../defaults.js";
import type {
  AssetConfig,
  AssetModels,
  BackgroundRemover,
  ImageGenerator,
  UnspoolerConfig,
  VideoGenerator,
} from "../types.js";
import { chromaKey } from "./chroma.js";
import { fal } from "./fal.js";
import { replicate } from "./replicate.js";

export { fal, falImage, falVideo } from "./fal.js";
export { replicate, replicateImage, replicateMatte, replicateVideo } from "./replicate.js";
export { chromaKey, keyFrame } from "./chroma.js";
export { httpImage, httpMatte, httpVideo } from "./http.js";
export { openai, openaiImage, openaiVideo, DEFAULT_OPENAI_IMAGE } from "./openai.js";
export { gemini, geminiImage, geminiVideo, nanoBanana, NANO_BANANA_MODEL } from "./gemini.js";
export { midjourney } from "./midjourney.js";
export type { FalOptions } from "./fal.js";
export type { ReplicateOptions } from "./replicate.js";
export type { ChromaKeyOptions } from "./chroma.js";
export type { HttpProviderOptions } from "./http.js";
export type { OpenAIOptions } from "./openai.js";
export type { GeminiOptions } from "./gemini.js";
export type { MidjourneyOptions, MidjourneyBackend } from "./midjourney.js";

export function isImageGenerator(value: unknown): value is ImageGenerator {
  return !!value && typeof value === "object" && (value as ImageGenerator).kind === "image";
}

export function isVideoGenerator(value: unknown): value is VideoGenerator {
  return !!value && typeof value === "object" && (value as VideoGenerator).kind === "video";
}

export function isBackgroundRemover(value: unknown): value is BackgroundRemover {
  return !!value && typeof value === "object" && (value as BackgroundRemover).kind === "matte";
}

function defaultImage(preset: UnspoolerConfig["preset"]): ImageGenerator {
  const spec = modelForPreset("reference", preset);
  return fal(spec.model, { kind: "image", usdPerCall: spec.usdPerCall }) as ImageGenerator;
}

function defaultVideo(preset: UnspoolerConfig["preset"], pixelArt: boolean): VideoGenerator {
  const spec = modelForPreset("video", preset, pixelArt);
  return fal(spec.model, { kind: "video", usdPerCall: spec.usdPerCall }) as VideoGenerator;
}

function defaultMatte(preset: UnspoolerConfig["preset"]): BackgroundRemover {
  if (preset === "draft") return chromaKey();
  const spec = PREFERRED_MODELS.matte;
  return replicate(spec.model, {
    kind: "matte",
    variant: spec.variant,
    usdPerCall: spec.usdPerCall,
  }) as BackgroundRemover;
}

export function resolveModels(
  config: UnspoolerConfig,
  asset?: AssetConfig,
): Required<AssetModels> {
  const pixelArt = Boolean(config.style.pixelNative);
  const preset = config.preset ?? "preferred";
  return {
    reference: asset?.models?.reference ?? config.models?.reference ?? defaultImage(preset),
    video: asset?.models?.video ?? config.models?.video ?? defaultVideo(preset, pixelArt),
    matte: asset?.models?.matte ?? config.models?.matte ?? defaultMatte(preset),
  };
}
