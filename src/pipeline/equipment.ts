import sharp from "sharp";
import { resolveChromaMode } from "../chroma.js";
import { buildEquipmentPrompt } from "../prompts.js";
import type {
  EquipmentFacingArt,
  EquipmentManifest,
  Facing,
  SlotName,
  Vec2,
} from "../rig/types.js";
import type {
  AssetConfig,
  BackgroundRemover,
  ImageGenerator,
  UnspoolerConfig,
} from "../types.js";
import { matteFrames } from "./matte.js";
import { isolateLargestBlob } from "./segment.js";

const VERSION = "0.1.0";
const PAD = 2;

/** Sensible item-height shares of character height per slot. */
const DEFAULT_ITEM_SCALE: Record<SlotName, number> = {
  head: 0.3,
  body: 0.45,
  "hand.main": 0.55,
  "hand.off": 0.4,
  feet: 0.12,
};

/** Where the attachment point sits inside the item art, per slot. */
const DEFAULT_ITEM_PIVOT: Record<SlotName, Vec2> = {
  head: { x: 0.5, y: 0.75 }, // helmet rim sits at the head bone + offset
  body: { x: 0.5, y: 0.6 },
  "hand.main": { x: 0.5, y: 0.85 }, // grip near the bottom (blade points up)
  "hand.off": { x: 0.5, y: 0.6 },
  feet: { x: 0.5, y: 0.35 }, // matches the foot part's ankle pivot
};

export async function generateEquipmentArt(opts: {
  config: UnspoolerConfig;
  asset: AssetConfig;
  facing: Facing;
  generator: ImageGenerator;
  /** Style/character reference images to keep the item on-style. */
  references?: Buffer[];
}): Promise<Buffer> {
  const { config, asset, facing, generator } = opts;
  const chroma = resolveChromaMode(asset.chroma ?? config.chroma ?? "auto", config.style.palette);
  const prompt = buildEquipmentPrompt({
    style: config.style,
    prompt: asset.prompt,
    facing,
    chroma,
  });
  const result = await generator.generate({
    prompt,
    references: opts.references,
    chroma,
    takes: 1,
    width: 1024,
    height: 1024,
  });
  const image = result.images[0];
  if (!image) throw new Error(`Equipment generation returned no image for ${asset.id}/${facing}`);
  return image;
}

export interface EquipmentFitInput {
  asset: AssetConfig;
  /** Raw generated art per facing (chroma backdrop still present). */
  facings: Partial<Record<Facing, Buffer>>;
  remover: BackgroundRemover;
  atlasName: string;
  /** Character height in pixels of the rig this item pairs with by default. */
  characterPixelHeight: number;
}

export interface EquipmentFitResult {
  atlas: Buffer;
  manifest: EquipmentManifest;
}

/**
 * Matte, trim, scale, and pack equipment art, and emit the manifest that the
 * RigPlayer consumes. The item is scaled so its height equals
 * `itemScale × characterPixelHeight`.
 */
export async function fitEquipment(input: EquipmentFitInput): Promise<EquipmentFitResult> {
  const slot = input.asset.slot;
  if (!slot) throw new Error(`Equipment asset "${input.asset.id}" needs a "slot" in its config.`);
  const itemScale = input.asset.itemScale ?? DEFAULT_ITEM_SCALE[slot];
  const pivotFrac = DEFAULT_ITEM_PIVOT[slot];
  const targetH = Math.max(4, Math.round(input.characterPixelHeight * itemScale));

  const cleaned: Array<{ facing: Facing; png: Buffer; w: number; h: number }> = [];
  for (const [facing, raw] of Object.entries(input.facings) as Array<[Facing, Buffer]>) {
    const [matted] = await matteFrames([raw], {
      remover: input.remover,
      chroma: input.asset.chroma,
      temporalSmooth: false,
    });
    const isolated = await isolateLargestBlob(matted!);
    if (!isolated) {
      throw new Error(`Equipment "${input.asset.id}" (${facing}) came out empty after matting.`);
    }
    const meta = await sharp(isolated).metadata();
    const h = meta.height ?? 1;
    const w = meta.width ?? 1;
    const factor = targetH / h;
    const outW = Math.max(1, Math.round(w * factor));
    const png =
      Math.abs(factor - 1) > 0.01
        ? await sharp(isolated).resize(outW, targetH, { fit: "fill" }).png().toBuffer()
        : isolated;
    cleaned.push({ facing, png, w: outW, h: targetH });
  }
  if (!cleaned.length) throw new Error(`No equipment art to fit for ${input.asset.id}`);

  const atlasW = cleaned.reduce((sum, c) => sum + c.w + PAD, PAD);
  const atlasH = targetH + PAD * 2;
  const composites: sharp.OverlayOptions[] = [];
  const facings: Partial<Record<Facing, EquipmentFacingArt>> = {};
  let x = PAD;
  for (const c of cleaned) {
    composites.push({ input: c.png, left: x, top: PAD });
    facings[c.facing] = {
      frame: { x, y: PAD, w: c.w, h: c.h },
      pivot: { x: pivotFrac.x * c.w, y: pivotFrac.y * c.h },
    };
    x += c.w + PAD;
  }

  const atlas = await sharp({
    create: { width: atlasW, height: atlasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .png()
    .toBuffer();

  const manifest: EquipmentManifest = {
    app: "unspooler",
    kind: "equipment",
    version: VERSION,
    assetId: input.asset.id,
    slot,
    mode: input.asset.equipMode ?? (slot === "feet" ? "replace" : "overlay"),
    atlas: input.atlasName,
    atlasSize: { w: atlasW, h: atlasH },
    pixelHeight: input.characterPixelHeight,
    gripOffset: input.asset.gripOffset,
    rotation: input.asset.equipRotation,
    facings,
  };

  return { atlas, manifest };
}
