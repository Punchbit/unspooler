import type { PresetName } from "./types.js";

/**
 * Preferred models per stage. These are defaults, not hard requirements —
 * anything implementing the provider interfaces can replace them.
 *
 * Prices are approximate USD list prices as of 2026 and used only for
 * `--dry-run` estimates. Override via adapter `estimate()` if you know better.
 */
export const PREFERRED_MODELS = {
  reference: {
    provider: "fal",
    model: "openai/gpt-image-2",
    rationale:
      "Strong at following style + reference images and producing a clean full-body character on a flat backdrop.",
    usdPerCall: 0.053,
  },
  referenceDraft: {
    provider: "fal",
    model: "fal-ai/flux/schnell",
    rationale: "Fast and cheap for iterating on silhouette and palette.",
    usdPerCall: 0.003,
  },
  video: {
    provider: "fal",
    model: "fal-ai/kling-video/v3/pro/image-to-video",
    rationale: "Best motion quality for looping in-place actions from a still.",
    usdPerCall: 0.28,
  },
  videoPixel: {
    provider: "fal",
    model: "fal-ai/wan/v2.2/a14b/image-to-video",
    rationale:
      "Pair with a pixel-animate LoRA when the project is pixel art. Better grid/style hold than cinematic models.",
    usdPerCall: 0.12,
  },
  videoDraft: {
    provider: "fal",
    model: "fal-ai/kling-video/v2.1/standard/image-to-video",
    rationale: "Cheaper / faster iteration before a final preferred-model pass.",
    usdPerCall: 0.07,
  },
  matte: {
    provider: "replicate",
    model: "sprited/birefnet",
    variant: "toonout",
    rationale:
      "MIT, commercial-OK, and the toonout variant keeps line art and stylized edges instead of smearing them.",
    usdPerCall: 0.004,
  },
  matteFallback: {
    provider: "chroma",
    model: "chroma-key",
    rationale: "Offline. Use when you have no API key, or as a fringe-cleanup prior on top of AI mattes.",
    usdPerCall: 0,
  },
} as const;

export const DEFAULT_FPS = 12;
export const DEFAULT_VIDEO_SECONDS = 5;
export const DEFAULT_CELL = 256;
export const DEFAULT_TAKES = 1;
export const DEFAULT_COST_THRESHOLD = 1;
export const DEFAULT_WORK_DIR = ".unspooler";
export const DEFAULT_OUT_DIR = "assets";
export const DEFAULT_MIRROR = true;

/**
 * Skeletal characters get the whole core library by default — animation is
 * bone data played locally, so extra clips cost nothing to generate.
 */
export const DEFAULT_CHARACTER_ANIMS = [
  "idle",
  "walk",
  "run",
  "jump",
  "attack",
  "hurt",
  "death",
] as const;

export const DIRECTION_PROMPTS: Record<string, string> = {
  down: "facing the camera, front view",
  left: "facing left, profile view",
  right: "facing right, profile view",
  up: "facing away from the camera, back view",
  "down-left": "facing down-left, three-quarter view",
  "down-right": "facing down-right, three-quarter view",
  "up-left": "facing up-left, three-quarter back view",
  "up-right": "facing up-right, three-quarter back view",
};

export const ANIMATION_PROMPTS: Record<string, string> = {
  idle: "gentle idle breathing cycle in place, subtle sway, looping back to the start pose",
  walk: "in-place walk cycle, legs stepping, torso centered, looping",
  run: "in-place run cycle, faster stride, torso centered, looping",
  attack: "a single attack swing or strike that returns to a ready pose, looping",
  hurt: "a short hit-reaction flinch that returns to stance, looping",
  jump: "a jump up and land back on the same spot, looping",
  death: "a collapse to the ground and hold the final pose",
};

export function modelForPreset(
  stage: "reference" | "video" | "matte",
  preset: PresetName = "preferred",
  pixelArt = false,
): { provider: string; model: string; usdPerCall: number; variant?: string } {
  if (stage === "reference") {
    return preset === "draft" ? PREFERRED_MODELS.referenceDraft : PREFERRED_MODELS.reference;
  }
  if (stage === "video") {
    if (preset === "draft") return PREFERRED_MODELS.videoDraft;
    return pixelArt ? PREFERRED_MODELS.videoPixel : PREFERRED_MODELS.video;
  }
  return PREFERRED_MODELS.matte;
}
