import { PREFERRED_MODELS } from "./defaults.js";
import type { AssetType, PresetName } from "./types.js";

export type InitImageProvider = "fal" | "openai" | "gemini" | "midjourney" | "replicate";
export type InitVideoProvider = "fal" | "openai" | "gemini" | "replicate";
/** @deprecated Use InitImageProvider. Kept so existing configs/tests still type-check. */
export type InitProvider = InitImageProvider;
export type InitMatte = "replicate" | "chroma";

export interface InitAnswers {
  stylePrompt: string;
  palette: string[];
  pixelNative: number;
  cellSize: number;
  provider: InitImageProvider;
  videoProvider: InitVideoProvider;
  matte: InitMatte;
  preset: PresetName;
  exportTargets: string[];
  outDir: string;
  fps: number;
  confirmAboveUsd: number;
  assetId: string;
  assetType: AssetType;
  assetPrompt: string;
  animations: string[];
  directions: 1 | 4 | 8;
  /** Equipment assets only: which skeleton slot the item occupies. */
  slot?: "head" | "body" | "hand.main" | "hand.off" | "feet";
}

export const DEFAULT_INIT: InitAnswers = {
  stylePrompt: "16-bit SNES JRPG pixel art, crisp clean pixels, consistent flat lighting",
  palette: ["#1b1b1e", "#f4efe4", "#c45c26", "#3d6b4f", "#d8b44a"],
  pixelNative: 32,
  cellSize: 256,
  provider: "fal",
  videoProvider: "fal",
  matte: "chroma",
  preset: "draft",
  exportTargets: ["generic", "css"],
  outDir: "assets",
  fps: 12,
  confirmAboveUsd: 1,
  assetId: "hero",
  assetType: "character",
  assetPrompt: "a small adventurer in a brown cloak and leather boots",
  animations: ["idle", "walk", "run", "jump", "attack", "hurt", "death"],
  directions: 4,
};

const IMAGE_PROVIDERS: InitImageProvider[] = ["fal", "openai", "gemini", "midjourney", "replicate"];
const VIDEO_PROVIDERS: InitVideoProvider[] = ["fal", "openai", "gemini", "replicate"];
const PROVIDER_ALIASES: Record<string, string> = {
  "nano banana": "gemini",
  "nano-banana": "gemini",
  nanobanana: "gemini",
  mj: "midjourney",
  gpt: "openai",
  sora: "openai",
  veo: "gemini",
};
const MATTES: InitMatte[] = ["chroma", "replicate"];
const PRESETS: PresetName[] = ["draft", "preferred"];
const ASSET_TYPES: AssetType[] = ["character", "static", "vfx", "tileset", "equipment"];
const EXPORTS = ["generic", "phaser", "godot", "css"];
const DIRECTIONS = [4, 8, 1] as const;

export function parseChoice<T extends string>(raw: string, allowed: readonly T[], fallback: T): T {
  const value = PROVIDER_ALIASES[raw.trim().toLowerCase()] ?? raw.trim().toLowerCase();
  if (!value) return fallback;
  if (/^\d+$/.test(value)) {
    const index = Number(value) - 1;
    return allowed[index] ?? fallback;
  }
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function parseList(raw: string, fallback: string[], allowed?: string[]): string[] {
  const items = raw
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!items.length) return fallback;
  const filtered = allowed ? items.filter((item) => allowed.includes(item)) : items;
  return filtered.length ? [...new Set(filtered)] : fallback;
}

export function parseNumber(raw: string, fallback: number, min = 0): number {
  if (!raw.trim()) return fallback;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n >= min ? n : fallback;
}

export function applyInitAnswers(partial: Partial<InitAnswers>): InitAnswers {
  return { ...DEFAULT_INIT, ...partial };
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function imageCall(provider: InitImageProvider, preset: PresetName): string {
  if (provider === "openai") {
    return preset === "draft"
      ? `openai(${quote("gpt-image-2")}, { quality: "low" })`
      : `openai(${quote("gpt-image-2")})`;
  }
  if (provider === "gemini") return "nanoBanana()";
  if (provider === "midjourney") return "midjourney()";
  const model =
    preset === "draft" ? PREFERRED_MODELS.referenceDraft.model : PREFERRED_MODELS.reference.model;
  return provider === "replicate"
    ? `replicate(${quote(model)}, { kind: "image" })`
    : `fal(${quote(model)})`;
}

function videoCall(provider: InitVideoProvider, preset: PresetName, pixelArt: boolean): string {
  if (provider === "openai") return `openai(${quote("sora-2")})`;
  if (provider === "gemini") return `gemini(${quote("veo-3.1-generate-preview")})`;
  const spec =
    preset === "draft"
      ? PREFERRED_MODELS.videoDraft
      : pixelArt
        ? PREFERRED_MODELS.videoPixel
        : PREFERRED_MODELS.video;
  return provider === "replicate"
    ? `replicate(${quote(spec.model)}, { kind: "video" })`
    : `fal(${quote(spec.model)})`;
}

export function defaultVideoProvider(image: InitImageProvider): InitVideoProvider {
  if (image === "openai" || image === "gemini") return image;
  return "fal";
}

function matteCall(matte: InitMatte): string {
  if (matte === "chroma") return "chromaKey()";
  return `replicate(${quote(PREFERRED_MODELS.matte.model)}, { variant: ${quote(PREFERRED_MODELS.matte.variant)} })`;
}

export function renderConfig(answers: InitAnswers): string {
  const imports = new Set(["defineConfig"]);
  if (answers.provider === "fal" || answers.videoProvider === "fal") imports.add("fal");
  if (answers.provider === "openai" || answers.videoProvider === "openai") imports.add("openai");
  if (answers.provider === "gemini") imports.add("nanoBanana");
  if (answers.videoProvider === "gemini") imports.add("gemini");
  if (answers.provider === "midjourney") imports.add("midjourney");
  if (answers.provider === "replicate" || answers.videoProvider === "replicate" || answers.matte === "replicate") {
    imports.add("replicate");
  }
  if (answers.matte === "chroma") imports.add("chromaKey");

  const pixelArt = answers.pixelNative > 0;
  const targets = [...new Set(["generic", ...answers.exportTargets])];
  const styleLines = [
    `    prompt: ${quote(answers.stylePrompt)},`,
    `    palette: ${JSON.stringify(answers.palette)},`,
    `    cellSize: ${answers.cellSize},`,
  ];
  if (pixelArt) styleLines.push(`    pixelNative: ${answers.pixelNative},`);

  const assetLines = [
    `      id: ${quote(answers.assetId)},`,
    `      type: ${quote(answers.assetType)},`,
    `      prompt: ${quote(answers.assetPrompt)},`,
  ];
  if (answers.assetType === "character" || answers.assetType === "vfx") {
    assetLines.push(`      animations: ${JSON.stringify(answers.animations)},`);
  }
  if (answers.assetType === "character") {
    assetLines.push(`      directions: ${answers.directions},`);
  }
  if (answers.assetType === "equipment" && answers.slot) {
    assetLines.push(`      slot: ${quote(answers.slot)},`);
  }

  return `import { ${[...imports].join(", ")} } from "unspooler";

export default defineConfig({
  style: {
${styleLines.join("\n")}
  },
  preset: ${quote(answers.preset)},
  models: {
    reference: ${imageCall(answers.provider, answers.preset)},
    video: ${videoCall(answers.videoProvider, answers.preset, pixelArt)},
    matte: ${matteCall(answers.matte)},
  },
  fps: ${answers.fps},
  export: {
    targets: ${JSON.stringify(targets)},
    outDir: ${quote(answers.outDir)},
  },
  cost: {
    confirmAboveUsd: ${answers.confirmAboveUsd},
  },
  assets: [
    {
${assetLines.join("\n")}
    },
  ],
});
`;
}

export function renderEnv(answers: InitAnswers): string {
  const lines = ["# unspooler — copy to .env and fill in what you use", ""];
  if (answers.provider === "fal" || answers.videoProvider === "fal") {
    lines.push("# fal.ai — preferred for image + video generation");
    lines.push("FAL_KEY=");
    lines.push("");
  }
  if (answers.provider === "openai" || answers.videoProvider === "openai") {
    lines.push("# OpenAI — gpt-image-2 + Sora");
    lines.push("OPENAI_API_KEY=");
    lines.push("");
  }
  if (answers.provider === "gemini" || answers.videoProvider === "gemini") {
    lines.push("# Google Gemini — Nano Banana image + Veo video");
    lines.push("GEMINI_API_KEY=");
    lines.push("");
  }
  if (answers.provider === "midjourney") {
    lines.push("# Midjourney has no official API. This key is for ImagineAPI or useapi.net.");
    lines.push("MIDJOURNEY_API_KEY=");
    lines.push("# MIDJOURNEY_BACKEND=imagineapi");
    lines.push("# MIDJOURNEY_BASE_URL=");
    lines.push("");
  }
  if (answers.provider === "replicate" || answers.videoProvider === "replicate" || answers.matte === "replicate") {
    lines.push("# Replicate — BiRefNet matting (and optional generation)");
    lines.push("REPLICATE_API_TOKEN=");
    lines.push("");
  }
  if (answers.matte === "chroma") {
    lines.push("# chromaKey() is offline — no token needed for matting.");
  }
  return `${lines.join("\n").trim()}\n`;
}

export const INIT_GITIGNORE = `
# unspooler
.unspooler/
`;

export const INIT_CONFIG = renderConfig(DEFAULT_INIT);
export const INIT_ENV = renderEnv(DEFAULT_INIT);

type Ask = (question: string) => Promise<string>;

function numbered(options: readonly string[], fallback: string): string {
  return options.map((option, i) => `    ${i + 1}) ${option}${option === fallback ? "  (default)" : ""}`).join("\n");
}

/**
 * Interactive init. Empty answers keep the default so the user can click through
 * by pressing Enter on every prompt.
 */
export async function promptInit(ask: Ask, defaults: InitAnswers = DEFAULT_INIT): Promise<InitAnswers> {
  const stylePrompt = (await ask(`Style prompt [${defaults.stylePrompt}]: `)).trim() || defaults.stylePrompt;
  const pixelRaw = await ask(`Pixel-native size, 0 to skip [${defaults.pixelNative}]: `);
  const pixelNative = parseNumber(pixelRaw, defaults.pixelNative);
  const cellSize = parseNumber(await ask(`Cell size [${defaults.cellSize}]: `), defaults.cellSize, 8);

  console.log("Image provider");
  console.log(numbered(IMAGE_PROVIDERS, defaults.provider));
  console.log("    fal · openai · gemini (nano banana) · midjourney (3rd-party gateway) · replicate");
  const provider = parseChoice(
    await ask(`Image provider [${defaults.provider}]: `),
    IMAGE_PROVIDERS,
    defaults.provider,
  );
  const videoDefault = defaultVideoProvider(provider);
  console.log("Video provider");
  console.log(numbered(VIDEO_PROVIDERS, videoDefault));
  console.log("    openai is Sora · gemini is Veo · midjourney is image-only so video stays on fal/openai/gemini");
  const videoProvider = parseChoice(
    await ask(`Video provider [${videoDefault}]: `),
    VIDEO_PROVIDERS,
    videoDefault,
  );

  console.log("Background removal");
  console.log(numbered(MATTES, defaults.matte));
  console.log("    chroma is offline · replicate BiRefNet is preferred (REPLICATE_API_TOKEN)");
  const matte = parseChoice(await ask(`Matte [${defaults.matte}]: `), MATTES, defaults.matte);

  console.log("Quality preset");
  console.log(numbered(PRESETS, defaults.preset));
  console.log("    draft = cheaper/faster models · preferred = production models");
  const preset = parseChoice(await ask(`Preset [${defaults.preset}]: `), PRESETS, defaults.preset);

  console.log(`Export targets: ${EXPORTS.join(", ")}`);
  const exportTargets = parseList(
    await ask(`Exports [${defaults.exportTargets.join(", ")}]: `),
    defaults.exportTargets,
    EXPORTS,
  );
  const outDir = (await ask(`Output directory [${defaults.outDir}]: `)).trim() || defaults.outDir;

  const assetId = (await ask(`First asset id [${defaults.assetId}]: `)).trim() || defaults.assetId;
  console.log("Asset type");
  console.log(numbered(ASSET_TYPES, defaults.assetType));
  const assetType = parseChoice(await ask(`Type [${defaults.assetType}]: `), ASSET_TYPES, defaults.assetType);
  const assetPrompt = (await ask(`Asset prompt [${defaults.assetPrompt}]: `)).trim() || defaults.assetPrompt;

  let animations = defaults.animations;
  let directions: 1 | 4 | 8 = defaults.directions;
  if (assetType === "character") {
    console.log(
      "    characters are skeletal: animations come from the built-in library (idle, walk, run, jump, attack, hurt, death) and bake locally at no AI cost",
    );
    animations = parseList(
      await ask(`Animations [${defaults.animations.join(", ")}]: `),
      defaults.animations,
    );
  } else if (assetType === "vfx") {
    animations = parseList(
      await ask(`Animations [${defaults.animations.join(", ")}]: `),
      defaults.animations,
    );
  }
  if (assetType === "character") {
    console.log("Facings");
    console.log(numbered(["4", "8", "1"], String(defaults.directions)));
    const dirRaw = await ask(`Directions [${defaults.directions}]: `);
    const parsed = parseNumber(dirRaw, defaults.directions);
    directions = (DIRECTIONS.includes(parsed as 1 | 4 | 8) ? parsed : defaults.directions) as 1 | 4 | 8;
  }

  let slot = defaults.slot;
  if (assetType === "equipment") {
    const slots = ["hand.main", "hand.off", "head", "body", "feet"] as const;
    console.log("Slot");
    console.log(numbered(slots as unknown as string[], "hand.main"));
    slot = parseChoice(await ask(`Slot [hand.main]: `), slots, "hand.main");
  }

  const fps = parseNumber(await ask(`FPS [${defaults.fps}]: `), defaults.fps, 1);
  const confirmAboveUsd = parseNumber(
    await ask(`Confirm builds above $ [${defaults.confirmAboveUsd}]: `),
    defaults.confirmAboveUsd,
  );

  return {
    stylePrompt,
    palette: defaults.palette,
    pixelNative,
    cellSize,
    provider,
    videoProvider,
    matte,
    preset,
    exportTargets,
    outDir,
    fps,
    confirmAboveUsd,
    assetId,
    assetType,
    assetPrompt,
    animations,
    directions,
    slot,
  };
}
