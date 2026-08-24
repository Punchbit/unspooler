import sharp from "sharp";
import { partByName } from "../rig/skeleton.js";
import type {
  Facing,
  PartName,
  RigManifest,
  RigOverrides,
  RigPartFrame,
  SkeletonSpec,
} from "../rig/types.js";
import type { SegmentedParts } from "./segment.js";

const VERSION = "0.1.0";
const PAD = 2;

export type { RigOverrides };

export interface FitInput {
  assetId: string;
  skeleton: SkeletonSpec;
  /** Segmented + trimmed parts per generated facing. */
  facings: Partial<Record<Facing, SegmentedParts>>;
  fps: number;
  animations: string[];
  atlasName: string;
  overrides?: RigOverrides;
}

export interface FitResult {
  atlas: Buffer;
  manifest: RigManifest;
}

/**
 * Fit segmented parts to the standard skeleton: normalize scale across
 * facings, pack everything into one atlas, and assign pixel pivots from the
 * skeleton's part specs (or Studio corrections).
 */
export async function fitToSkeleton(input: FitInput): Promise<FitResult> {
  const { skeleton } = input;

  // Measure everything up front.
  const measured: Array<{
    facing: Facing;
    part: PartName;
    png: Buffer;
    w: number;
    h: number;
  }> = [];
  for (const [facing, parts] of Object.entries(input.facings) as Array<[Facing, SegmentedParts]>) {
    for (const [part, png] of parts) {
      const meta = await sharp(png).metadata();
      measured.push({ facing, part, png, w: meta.width ?? 1, h: meta.height ?? 1 });
    }
  }
  if (!measured.length) throw new Error(`No parts to fit for ${input.assetId}`);

  // Each part implies a character height (partHeight / expectedShare). The
  // median across a facing is that facing's scale; normalize facings to the
  // global median so side/up art can't come out bigger than front art.
  const perFacingEstimate = new Map<Facing, number>();
  for (const facing of Object.keys(input.facings) as Facing[]) {
    const estimates = measured
      .filter((m) => m.facing === facing)
      .map((m) => m.h / partByName(skeleton, m.part).approxHeight);
    perFacingEstimate.set(facing, median(estimates));
  }
  const pixelHeight = Math.round(median([...perFacingEstimate.values()]));

  for (const m of measured) {
    const facingEstimate = perFacingEstimate.get(m.facing)!;
    const factor = pixelHeight / facingEstimate;
    if (Math.abs(factor - 1) > 0.02) {
      const w = Math.max(1, Math.round(m.w * factor));
      const h = Math.max(1, Math.round(m.h * factor));
      m.png = await sharp(m.png).resize(w, h, { fit: "fill" }).png().toBuffer();
      m.w = w;
      m.h = h;
    }
  }

  // Shelf-pack: one row per facing keeps the atlas readable in the Studio.
  const facingsInOrder = (Object.keys(input.facings) as Facing[]).sort();
  const rows = facingsInOrder.map((facing) => measured.filter((m) => m.facing === facing));
  const atlasW = Math.max(
    1,
    ...rows.map((row) => row.reduce((sum, m) => sum + m.w + PAD, PAD)),
  );
  const rowHeights = rows.map((row) => Math.max(1, ...row.map((m) => m.h)) + PAD * 2);
  const atlasH = rowHeights.reduce((a, b) => a + b, 0);

  const composites: sharp.OverlayOptions[] = [];
  const facings: RigManifest["facings"] = {};
  let y = 0;
  for (let r = 0; r < rows.length; r++) {
    const facing = facingsInOrder[r]!;
    const parts: Partial<Record<PartName, RigPartFrame>> = {};
    let x = PAD;
    for (const m of rows[r]!) {
      composites.push({ input: m.png, left: x, top: y + PAD });
      const spec = partByName(skeleton, m.part);
      const override = input.overrides?.[facing]?.[m.part]?.pivot;
      const pivotFrac = override ?? spec.pivot;
      parts[m.part] = {
        frame: { x, y: y + PAD, w: m.w, h: m.h },
        pivot: { x: pivotFrac.x * m.w, y: pivotFrac.y * m.h },
      };
      x += m.w + PAD;
    }
    facings[facing] = { parts };
    y += rowHeights[r]!;
  }

  const atlas = await sharp({
    create: {
      width: atlasW,
      height: atlasH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();

  const manifest: RigManifest = {
    app: "unspooler",
    kind: "rig",
    version: VERSION,
    assetId: input.assetId,
    skeleton: { id: skeleton.id, version: skeleton.version },
    atlas: input.atlasName,
    atlasSize: { w: atlasW, h: atlasH },
    pixelHeight,
    facings,
    animations: input.animations,
    fps: input.fps,
  };

  return { atlas, manifest };
}

function median(values: number[]): number {
  if (!values.length) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
