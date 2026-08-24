import { PREFERRED_MODELS } from "./defaults.js";

export type PriceQuality = "low" | "medium" | "high" | "auto";

export interface PriceLookup {
  quality?: string;
  size?: string;
}

export interface ModelPriceTier {
  /** Used when quality is omitted or unknown. */
  default: number;
  quality?: Partial<Record<PriceQuality, number>>;
}

/**
 * Approximate USD per generation. Quality tiers matter a lot on GPT Image —
 * gpt-image-2 low is ~35× cheaper than high at the same size.
 *
 * These are calculator-style estimates for `--dry-run`, not invoices.
 */
export const MODEL_PRICE_TIERS: Record<string, ModelPriceTier> = {
  [PREFERRED_MODELS.reference.model]: {
    default: 0.053,
    quality: { low: 0.006, medium: 0.053, high: 0.211 },
  },
  [PREFERRED_MODELS.referenceDraft.model]: { default: PREFERRED_MODELS.referenceDraft.usdPerCall },
  [PREFERRED_MODELS.video.model]: { default: PREFERRED_MODELS.video.usdPerCall },
  [PREFERRED_MODELS.videoPixel.model]: { default: PREFERRED_MODELS.videoPixel.usdPerCall },
  [PREFERRED_MODELS.videoDraft.model]: { default: PREFERRED_MODELS.videoDraft.usdPerCall },
  [PREFERRED_MODELS.matte.model]: { default: PREFERRED_MODELS.matte.usdPerCall },
  "openai/gpt-image-2/edit": {
    default: 0.053,
    quality: { low: 0.006, medium: 0.053, high: 0.211 },
  },
  "gpt-image-2": {
    default: 0.053,
    quality: { low: 0.006, medium: 0.053, high: 0.211 },
  },
  "gpt-image-1.5": {
    default: 0.05,
    quality: { low: 0.01, medium: 0.05, high: 0.17 },
  },
  "gpt-image-1": {
    default: 0.04,
    quality: { low: 0.01, medium: 0.04, high: 0.16 },
  },
  "dall-e-3": { default: 0.08 },
  "sora-2": { default: 0.5 },
  "sora-2-pro": { default: 0.8 },
  "gemini-3.1-flash-image": { default: 0.04 },
  "gemini-3-pro-image": { default: 0.08 },
  "veo-3.1-generate-preview": { default: 0.35 },
  "veo-3.0-generate-001": { default: 0.4 },
  midjourney: { default: 0.08 },
  "fal-ai/flux/dev": { default: 0.025 },
  "fal-ai/bria/background-removal": { default: 0.018 },
  "sprited/birefnet-video": { default: 0.02 },
};

/** Flat defaults (medium / unspecified quality) for older callers. */
export const MODEL_PRICES: Record<string, number> = Object.fromEntries(
  Object.entries(MODEL_PRICE_TIERS).map(([id, tier]) => [id, tier.default]),
);

export function normalizeQuality(quality?: string): PriceQuality | undefined {
  if (!quality) return undefined;
  const value = quality.toLowerCase();
  if (value === "low" || value === "medium" || value === "high" || value === "auto") return value;
  return undefined;
}

export function lookupTier(model: string): ModelPriceTier | undefined {
  if (model in MODEL_PRICE_TIERS) return MODEL_PRICE_TIERS[model];
  const hit = Object.entries(MODEL_PRICE_TIERS).find(
    ([id]) => model.includes(id) || id.includes(model),
  );
  return hit?.[1];
}

export function priceFor(model: string, fallback = 0.05, options: PriceLookup = {}): number {
  const tier = lookupTier(model);
  if (!tier) return fallback;
  const quality = normalizeQuality(options.quality);
  if (quality && tier.quality?.[quality] != null) return tier.quality[quality]!;
  return tier.default;
}
