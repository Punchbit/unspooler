export { defineConfig, loadConfig, findConfigPath, validateConfig } from "./config.js";
export { unspool } from "./pipeline/orchestrate.js";
export {
  generateReference,
  generateVideo,
  extractFrames,
  dedupeFrames,
  detectLoopWindow,
  applyLoopWindow,
  matteFrames,
  smoothMattes,
  normalizeFrames,
  pixelSnap,
  packSheet,
  measureSeams,
  sliceTiles,
} from "./pipeline/index.js";
export {
  fal,
  falImage,
  falVideo,
  replicate,
  replicateImage,
  replicateVideo,
  replicateMatte,
  chromaKey,
  httpImage,
  httpVideo,
  httpMatte,
  openai,
  openaiImage,
  openaiVideo,
  gemini,
  geminiImage,
  geminiVideo,
  nanoBanana,
  midjourney,
  resolveModels,
} from "./providers/index.js";
export { registerExporter, getExporter, listExporters } from "./exporters/index.js";
export { formatPlan, planAsset, summarizePlan } from "./cost.js";
export { CharacterController, bindKeys, directionFromVector } from "./controller/index.js";
export { PREFERRED_MODELS } from "./defaults.js";
export { priceFor, MODEL_PRICE_TIERS } from "./prices.js";
export { manifestToJson, parseManifest, framesFor } from "./manifest.js";
export { Cache, StateStore } from "./cache.js";

export type {
  UnspoolerConfig,
  AssetConfig,
  AssetType,
  StyleConfig,
  ImageGenerator,
  VideoGenerator,
  BackgroundRemover,
  Exporter,
  SpriteManifest,
  SpriteFrame,
  BuildPlan,
  BuildResult,
  UnspoolOptions,
  Direction,
} from "./types.js";
