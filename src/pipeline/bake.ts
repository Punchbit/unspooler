import sharp from "sharp";
import { getClip } from "../rig/animations/index.js";
import { RigPlayer } from "../rig/player.js";
import type {
  AnimationClip,
  DrawCommand,
  EquipmentManifest,
  RigManifest,
  SkeletonSpec,
} from "../rig/types.js";
import type { Direction, HexColor } from "../types.js";
import type { NormalizedFrame } from "./normalize.js";
import { pixelSnap } from "./normalize.js";
import type { PackedClip } from "./pack.js";

const PAD = 4;

export interface EquippedArt {
  manifest: EquipmentManifest;
  atlas: Buffer;
}

export interface BakeOptions {
  rig: RigManifest;
  atlas: Buffer;
  equipment?: EquippedArt[];
  skeleton?: SkeletonSpec;
  clips?: Record<string, AnimationClip>;
  cell: { w: number; h: number };
  fps: number;
  animations: string[];
  directions: Direction[];
  pixelNative?: number;
  palette?: HexColor[];
}

/**
 * Render a skeletal character (plus any equipped items) into ordinary
 * spritesheet clips — deterministic, local, zero AI cost. The output feeds
 * the existing packSheet + exporters, so every engine that consumes flat
 * sheets keeps working.
 */
export async function bakeClips(options: BakeOptions): Promise<PackedClip[]> {
  const player = new RigPlayer(options.rig, {
    skeleton: options.skeleton,
    clips: options.clips,
  });
  for (const item of options.equipment ?? []) player.equip(item.manifest);

  const atlases = new Map<string, Buffer>([["__rig__", options.atlas]]);
  for (const item of options.equipment ?? []) atlases.set(item.manifest.atlas, item.atlas);

  // Leave headroom: arms over head, jump crouch, death sprawl.
  const outScale = (options.cell.h - PAD * 2) / (options.rig.pixelHeight * 1.18);
  const anchor = { x: options.cell.w / 2, y: options.cell.h - PAD };

  const packed: PackedClip[] = [];
  for (const name of options.animations) {
    const clip = getClip(name, options.clips);
    if (!clip) {
      console.warn(
        `[unspooler] "${name}" is not in the animation library — skipping. Core clips: idle, walk, run, jump, attack, hurt, death.`,
      );
      continue;
    }
    const frameCount = Math.max(2, Math.round((clip.durationMs / 1000) * options.fps));
    for (const direction of options.directions) {
      const frames: NormalizedFrame[] = [];
      for (let i = 0; i < frameCount; i++) {
        // Loops sample [0, duration) so the wrap frame isn't duplicated;
        // one-shots include the final pose.
        const t = clip.loop
          ? (i / frameCount) * clip.durationMs
          : (i / (frameCount - 1)) * clip.durationMs;
        const commands = player.drawList(name, t, direction, { scale: outScale });
        let png = await renderCommands(commands, atlases, options.cell, anchor, outScale);
        if (options.pixelNative) {
          png = await pixelSnap(png, options.pixelNative, options.palette);
        }
        frames.push({ png, anchor });
      }
      packed.push({
        animation: name,
        direction: options.directions.length > 1 ? direction : undefined,
        loop: clip.loop,
        fps: options.fps,
        frames,
      });
    }
  }
  return packed;
}

/**
 * Composite one draw list onto a transparent cell. Commands are already
 * back-to-front; positions are rig pixels relative to the feet origin.
 */
export async function renderCommands(
  commands: DrawCommand[],
  atlases: Map<string, Buffer>,
  cell: { w: number; h: number },
  anchor: { x: number; y: number },
  positionScale: number,
): Promise<Buffer> {
  const composites: sharp.OverlayOptions[] = [];

  for (const cmd of commands) {
    const atlas = atlases.get(cmd.atlas ?? "__rig__");
    if (!atlas) continue;

    let sprite = sharp(atlas).extract({
      left: Math.max(0, Math.round(cmd.frame.x)),
      top: Math.max(0, Math.round(cmd.frame.y)),
      width: Math.round(cmd.frame.w),
      height: Math.round(cmd.frame.h),
    });
    if (cmd.flipX) sprite = sprite.flop();

    const w1 = Math.max(1, Math.round(cmd.frame.w * cmd.scale));
    const h1 = Math.max(1, Math.round(cmd.frame.h * cmd.scale));
    let buf = await sprite.resize(w1, h1, { fit: "fill" }).png().toBuffer();

    const pivot = { x: cmd.pivot.x * cmd.scale, y: cmd.pivot.y * cmd.scale };
    const deg = (cmd.rotation * 180) / Math.PI;
    let placedPivot = pivot;
    if (Math.abs(deg) > 0.01) {
      buf = await sharp(buf)
        .rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      const meta = await sharp(buf).metadata();
      const w2 = meta.width ?? w1;
      const h2 = meta.height ?? h1;
      // sharp rotates about the center and expands the canvas; track where
      // the pivot lands. Positive degrees are clockwise in y-down space.
      const cos = Math.cos(cmd.rotation);
      const sin = Math.sin(cmd.rotation);
      const dx = pivot.x - w1 / 2;
      const dy = pivot.y - h1 / 2;
      placedPivot = {
        x: w2 / 2 + dx * cos - dy * sin,
        y: h2 / 2 + dx * sin + dy * cos,
      };
    }

    const left = Math.round(anchor.x + cmd.x * positionScale - placedPivot.x);
    const top = Math.round(anchor.y + cmd.y * positionScale - placedPivot.y);
    const clipped = await clipToCell(buf, left, top, cell);
    if (clipped) composites.push(clipped);
  }

  return sharp({
    create: {
      width: cell.w,
      height: cell.h,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

/** sharp rejects composites that overflow the canvas, so pre-crop. */
async function clipToCell(
  buf: Buffer,
  left: number,
  top: number,
  cell: { w: number; h: number },
): Promise<sharp.OverlayOptions | null> {
  const meta = await sharp(buf).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const x0 = Math.max(0, left);
  const y0 = Math.max(0, top);
  const x1 = Math.min(cell.w, left + w);
  const y1 = Math.min(cell.h, top + h);
  if (x1 <= x0 || y1 <= y0) return null;
  if (x0 === left && y0 === top && x1 === left + w && y1 === top + h) {
    return { input: buf, left, top };
  }
  const cropped = await sharp(buf)
    .extract({ left: x0 - left, top: y0 - top, width: x1 - x0, height: y1 - y0 })
    .png()
    .toBuffer();
  return { input: cropped, left: x0, top: y0 };
}
