import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  DEFAULT_CELL,
  DEFAULT_CHARACTER_ANIMS,
  DEFAULT_COST_THRESHOLD,
  DEFAULT_FPS,
  DEFAULT_MIRROR,
  DEFAULT_OUT_DIR,
  DEFAULT_VIDEO_SECONDS,
  DEFAULT_WORK_DIR,
} from "./defaults.js";
import type {
  AnimationSpec,
  AssetConfig,
  ResolvedAnimation,
  UnspoolerConfig,
} from "./types.js";
import { DIRECTIONS_4, DIRECTIONS_8, type Direction } from "./types.js";

const hex = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);

const animationSpecSchema = z.object({
  name: z.string().min(1),
  prompt: z.string().optional(),
  fps: z.number().positive().optional(),
  loop: z.boolean().optional(),
  duration: z.number().positive().optional(),
  video: z.any().optional(),
  mirrorFrom: z.string().optional(),
});

const assetSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["character", "static", "vfx", "tileset", "equipment"]),
  prompt: z.string().min(1),
  references: z.array(z.string()).optional(),
  animations: z.array(z.union([z.string(), animationSpecSchema])).optional(),
  directions: z.union([z.literal(1), z.literal(4), z.literal(8)]).optional(),
  mirrorHorizontal: z.boolean().optional(),
  chroma: z.enum(["green", "magenta", "auto"]).optional(),
  fps: z.number().positive().optional(),
  models: z.any().optional(),
  tileSize: z.number().positive().optional(),
  tileGrid: z
    .object({
      cols: z.number().int().positive(),
      rows: z.number().int().positive(),
    })
    .optional(),
  slot: z.enum(["head", "body", "hand.main", "hand.off", "feet"]).optional(),
  equipMode: z.enum(["overlay", "replace"]).optional(),
  gripOffset: z.object({ x: z.number(), y: z.number() }).optional(),
  equipRotation: z.number().optional(),
  itemScale: z.number().positive().max(2).optional(),
});

export const configSchema = z.object({
  style: z.object({
    prompt: z.string().min(1),
    palette: z.array(hex).optional(),
    cellSize: z.number().positive().optional(),
    cellHeight: z.number().positive().optional(),
    pixelNative: z.number().positive().optional(),
    references: z.array(z.string()).optional(),
  }),
  models: z.any().optional(),
  preset: z.enum(["draft", "preferred"]).optional(),
  assets: z.array(assetSchema).min(1),
  export: z
    .object({
      targets: z.array(z.string()).optional(),
      outDir: z.string().optional(),
    })
    .optional(),
  cost: z
    .object({
      confirmAboveUsd: z.number().nonnegative().optional(),
    })
    .optional(),
  workDir: z.string().optional(),
  fps: z.number().positive().optional(),
  chroma: z.enum(["green", "magenta", "auto"]).optional(),
});

export function defineConfig(config: UnspoolerConfig): UnspoolerConfig {
  return configSchema.parse(config) as UnspoolerConfig;
}

export function validateConfig(config: unknown): UnspoolerConfig {
  return configSchema.parse(config) as UnspoolerConfig;
}

const CONFIG_FILES = [
  "unspooler.config.ts",
  "unspooler.config.mts",
  "unspooler.config.js",
  "unspooler.config.mjs",
  "unspooler.config.json",
];

export function findConfigPath(cwd = process.cwd()): string | null {
  for (const name of CONFIG_FILES) {
    const candidate = resolve(cwd, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function loadConfig(cwd = process.cwd(), explicit?: string): Promise<UnspoolerConfig> {
  const path = explicit ? resolve(cwd, explicit) : findConfigPath(cwd);
  if (!path) {
    throw new Error(
      `No unspooler.config.ts found in ${cwd}. Run \`unspooler init\` or pass --config.`,
    );
  }
  if (path.endsWith(".json")) {
    const { readFile } = await import("node:fs/promises");
    return validateConfig(JSON.parse(await readFile(path, "utf8")));
  }
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url);
  const mod = (await jiti.import(pathToFileURL(path).href)) as {
    default?: UnspoolerConfig;
  } & UnspoolerConfig;
  const raw = (mod.default ?? mod) as UnspoolerConfig;
  return validateConfig(raw);
}

export function resolveWorkDir(config: UnspoolerConfig, cwd: string): string {
  return resolve(cwd, config.workDir ?? DEFAULT_WORK_DIR);
}

export function resolveOutDir(config: UnspoolerConfig, cwd: string): string {
  return resolve(cwd, config.export?.outDir ?? DEFAULT_OUT_DIR);
}

export function resolveFps(config: UnspoolerConfig, asset: AssetConfig, anim?: AnimationSpec | string): number {
  if (typeof anim === "object" && anim.fps) return anim.fps;
  return asset.fps ?? config.fps ?? DEFAULT_FPS;
}

export function resolveAnimations(config: UnspoolerConfig, asset: AssetConfig): ResolvedAnimation[] {
  if (asset.type === "static" || asset.type === "tileset" || asset.type === "equipment") return [];
  const listed = asset.animations?.length
    ? asset.animations
    : asset.type === "vfx"
      ? [{ name: "play", loop: false }]
      : [...DEFAULT_CHARACTER_ANIMS];

  return listed.map((item) => {
    const spec: AnimationSpec = typeof item === "string" ? { name: item } : item;
    return {
      name: spec.name,
      prompt: spec.prompt ?? "",
      fps: spec.fps ?? asset.fps ?? config.fps ?? DEFAULT_FPS,
      loop: spec.loop ?? spec.name !== "death",
      duration: spec.duration ?? DEFAULT_VIDEO_SECONDS,
      video: spec.video,
      mirrorFrom: spec.mirrorFrom as Direction | undefined,
    };
  });
}

export function resolveDirections(asset: AssetConfig): Direction[] {
  if (asset.type !== "character") return ["down"];
  const count = asset.directions ?? 4;
  if (count === 1) return ["down"];
  if (count === 8) return [...DIRECTIONS_8];
  return [...DIRECTIONS_4];
}

/**
 * Which facings need generated parts art for a skeletal character (or
 * equipment). Side art is drawn once (facing left) and mirrored for right.
 */
export function resolveFacings(asset: AssetConfig): Array<"down" | "side" | "up"> {
  const count = asset.directions ?? (asset.type === "equipment" ? 4 : 4);
  return count === 1 ? ["down"] : ["down", "side", "up"];
}

export function directionsToGenerate(asset: AssetConfig): Direction[] {
  const dirs = resolveDirections(asset);
  const mirror = asset.mirrorHorizontal ?? DEFAULT_MIRROR;
  if (!mirror || (asset.directions ?? 4) === 1) return dirs;
  return dirs.filter((d) => !d.includes("right"));
}

export function mirrorOf(direction: Direction): Direction | null {
  if (direction === "left") return "right";
  if (direction === "down-left") return "down-right";
  if (direction === "up-left") return "up-right";
  return null;
}

export function cellSize(config: UnspoolerConfig): { w: number; h: number } {
  const w = config.style.cellSize ?? DEFAULT_CELL;
  const h = config.style.cellHeight ?? w;
  return { w, h };
}

export function costThreshold(config: UnspoolerConfig): number {
  return config.cost?.confirmAboveUsd ?? DEFAULT_COST_THRESHOLD;
}

export function exportTargets(config: UnspoolerConfig): string[] {
  const targets = new Set(config.export?.targets ?? ["generic"]);
  targets.add("generic");
  return [...targets];
}
