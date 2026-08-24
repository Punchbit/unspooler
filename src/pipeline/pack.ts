import sharp from "sharp";
import type {
  AssetConfig,
  AssetType,
  Direction,
  SpriteFrame,
  SpriteManifest,
} from "../types.js";
import type { AnchorMode, NormalizedFrame } from "./normalize.js";

const VERSION = "0.1.0";

export interface PackedClip {
  animation: string;
  direction?: Direction;
  loop: boolean;
  fps: number;
  frames: NormalizedFrame[];
}

export interface PackedSheet {
  sheet: Buffer;
  manifest: SpriteManifest;
}

export async function packSheet(opts: {
  asset: AssetConfig;
  clips: PackedClip[];
  cell: { w: number; h: number };
  fps: number;
  anchorMode: AnchorMode;
  imageName: string;
}): Promise<PackedSheet> {
  const frames: SpriteFrame[] = [];
  const tags: SpriteManifest["meta"]["frameTags"] = [];
  const composites: { input: Buffer; left: number; top: number }[] = [];

  let x = 0;
  let index = 0;
  const cell = opts.cell;
  const duration = Math.round(1000 / opts.fps);

  for (const clip of opts.clips) {
    const from = index;
    for (let i = 0; i < clip.frames.length; i++) {
      const fr = clip.frames[i]!;
      composites.push({ input: fr.png, left: x, top: 0 });
      const dir = clip.direction;
      const filename = dir
        ? `${opts.asset.id}-${clip.animation}-${dir}-${i}.png`
        : `${opts.asset.id}-${clip.animation}-${i}.png`;
      frames.push({
        filename,
        frame: { x, y: 0, w: cell.w, h: cell.h },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: cell.w, h: cell.h },
        sourceSize: { w: cell.w, h: cell.h },
        duration,
        anchor: fr.anchor,
        animation: clip.animation,
        direction: dir,
        index: i,
      });
      x += cell.w;
      index++;
    }
    const to = index - 1;
    if (to >= from) {
      tags.push({
        name: clip.direction ? `${clip.animation}-${clip.direction}` : clip.animation,
        from,
        to,
        direction: "forward",
        loop: clip.loop,
      });
    }
  }

  const width = Math.max(cell.w, x);
  const height = cell.h;
  const sheet = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();

  const firstAnchor = opts.clips[0]?.frames[0]?.anchor ?? { x: cell.w / 2, y: cell.h };
  const manifest: SpriteManifest = {
    frames,
    meta: {
      app: "unspooler",
      version: VERSION,
      image: opts.imageName,
      format: "RGBA8888",
      size: { w: width, h: height },
      scale: "1",
      cell,
      fps: opts.fps,
      assetId: opts.asset.id,
      assetType: opts.asset.type as AssetType,
      frameTags: tags,
      anchors: {
        mode: opts.anchorMode,
        x: firstAnchor.x,
        y: firstAnchor.y,
      },
    },
  };

  return { sheet, manifest };
}
