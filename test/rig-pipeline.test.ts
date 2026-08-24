import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { bakeClips } from "../src/pipeline/bake.js";
import { fitEquipment } from "../src/pipeline/equipment.js";
import { fitToSkeleton } from "../src/pipeline/fit.js";
import { isolateLargestBlob, segmentParts, type SegmentedParts } from "../src/pipeline/segment.js";
import { HUMANOID } from "../src/rig/skeleton.js";
import type { Facing, PartName } from "../src/rig/types.js";
import type { BackgroundRemover } from "../src/types.js";

/** Matte pass-through for images that are already transparent. */
const noopMatte: BackgroundRemover = {
  kind: "matte",
  id: "chroma:test",
  remove: async ({ frames }) => ({ frames, model: "noop" }),
};

async function coloredRect(w: number, h: number, rgb: [number, number, number]): Promise<Buffer> {
  return sharp({
    create: { width: w, height: h, channels: 4, background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha: 1 } },
  })
    .png()
    .toBuffer();
}

/** Roughly humanoid part sizes at a 200px character height. */
function partSize(part: PartName): { w: number; h: number } {
  const share = HUMANOID.parts.find((p) => p.name === part)!.approxHeight;
  return { w: Math.max(8, Math.round(share * 100)), h: Math.max(8, Math.round(share * 200)) };
}

async function syntheticParts(): Promise<SegmentedParts> {
  const parts: SegmentedParts = new Map();
  for (const part of HUMANOID.parts) {
    const { w, h } = partSize(part.name);
    parts.set(part.name, await coloredRect(w, h, [200, 80, 40]));
  }
  return parts;
}

describe("segmentation", () => {
  it("keeps only the largest blob", async () => {
    const canvas = sharp({
      create: { width: 100, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    });
    const big = await coloredRect(30, 30, [255, 0, 0]);
    const speck = await coloredRect(4, 4, [0, 255, 0]);
    const png = await canvas
      .composite([
        { input: big, left: 5, top: 10 },
        { input: speck, left: 80, top: 5 },
      ])
      .png()
      .toBuffer();
    const isolated = await isolateLargestBlob(png);
    expect(isolated).not.toBeNull();
    const meta = await sharp(isolated!).metadata();
    expect(meta.width).toBe(30);
    expect(meta.height).toBe(30);
  });

  it("slices a gridded parts sheet into all named parts", async () => {
    const { cols, rows, order } = HUMANOID.sheetLayout;
    const cell = 100;
    const composites: sharp.OverlayOptions[] = [];
    for (let i = 0; i < order.length; i++) {
      const blob = await coloredRect(40, 60, [10 * i + 30, 120, 200]);
      composites.push({
        input: blob,
        left: (i % cols) * cell + 30,
        top: Math.floor(i / cols) * cell + 20,
      });
    }
    const sheet = await sharp({
      create: { width: cols * cell, height: rows * cell, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite(composites)
      .png()
      .toBuffer();

    const parts = await segmentParts(sheet, { skeleton: HUMANOID, remover: noopMatte });
    expect(parts.size).toBe(order.length);
    for (const name of order) expect(parts.has(name as PartName)).toBe(true);
  });

  it("reports which parts came out empty", async () => {
    const blank = await sharp({
      create: { width: 400, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    await expect(segmentParts(blank, { skeleton: HUMANOID, remover: noopMatte })).rejects.toThrow(
      /no content/,
    );
  });
});

describe("skeleton fit", () => {
  it("packs parts into an atlas with pivots and a sane pixel height", async () => {
    const facings: Partial<Record<Facing, SegmentedParts>> = {
      down: await syntheticParts(),
      side: await syntheticParts(),
    };
    const { atlas, manifest } = await fitToSkeleton({
      assetId: "hero",
      skeleton: HUMANOID,
      facings,
      fps: 12,
      animations: ["idle", "walk"],
      atlasName: "hero.rig.png",
      overrides: { down: { head: { pivot: { x: 0.25, y: 0.5 } } } },
    });
    expect(manifest.pixelHeight).toBeGreaterThan(100);
    expect(manifest.pixelHeight).toBeLessThan(400);
    expect(Object.keys(manifest.facings)).toEqual(["down", "side"]);
    const down = manifest.facings.down!;
    expect(Object.keys(down.parts)).toHaveLength(HUMANOID.parts.length);

    // Override moved the head pivot to 25% width / 50% height.
    const head = down.parts.head!;
    expect(head.pivot.x).toBeCloseTo(head.frame.w * 0.25, 1);
    expect(head.pivot.y).toBeCloseTo(head.frame.h * 0.5, 1);

    const meta = await sharp(atlas).metadata();
    expect(meta.width).toBe(manifest.atlasSize.w);
    expect(meta.height).toBe(manifest.atlasSize.h);
  });
});

describe("bake", () => {
  it("renders animation clips into cell-sized frames, locally", async () => {
    const facings: Partial<Record<Facing, SegmentedParts>> = { down: await syntheticParts() };
    const { atlas, manifest } = await fitToSkeleton({
      assetId: "hero",
      skeleton: HUMANOID,
      facings,
      fps: 6,
      animations: ["idle"],
      atlasName: "hero.rig.png",
    });
    const clips = await bakeClips({
      rig: manifest,
      atlas,
      cell: { w: 96, h: 96 },
      fps: 6,
      animations: ["idle", "not-a-real-clip"],
      directions: ["down"],
    });
    expect(clips).toHaveLength(1);
    const idle = clips[0]!;
    expect(idle.animation).toBe("idle");
    expect(idle.frames.length).toBeGreaterThanOrEqual(2);
    for (const frame of idle.frames) {
      const meta = await sharp(frame.png).metadata();
      expect(meta.width).toBe(96);
      expect(meta.height).toBe(96);
    }
    // The character actually rendered: frames are not empty.
    const stats = await sharp(idle.frames[0]!.png).stats();
    expect(stats.channels[3]!.max).toBeGreaterThan(0);
  });

  it("bakes equipment into the sheet deterministically", async () => {
    const facings: Partial<Record<Facing, SegmentedParts>> = { down: await syntheticParts() };
    const { atlas, manifest } = await fitToSkeleton({
      assetId: "hero",
      skeleton: HUMANOID,
      facings,
      fps: 6,
      animations: ["idle"],
      atlasName: "hero.rig.png",
    });
    const item = await fitEquipment({
      asset: { id: "sword", type: "equipment", prompt: "sword", slot: "hand.main" },
      facings: { down: await coloredRect(20, 120, [0, 255, 0]) },
      remover: noopMatte,
      atlasName: "sword.equip.png",
      characterPixelHeight: manifest.pixelHeight,
    });
    expect(item.manifest.slot).toBe("hand.main");
    expect(item.manifest.mode).toBe("overlay");

    const bare = await bakeClips({
      rig: manifest,
      atlas,
      cell: { w: 96, h: 96 },
      fps: 6,
      animations: ["idle"],
      directions: ["down"],
    });
    const armed = await bakeClips({
      rig: manifest,
      atlas,
      equipment: [{ manifest: item.manifest, atlas: item.atlas }],
      cell: { w: 96, h: 96 },
      fps: 6,
      animations: ["idle"],
      directions: ["down"],
    });
    // Same determinism, more pixels: the sword adds opaque area.
    const bareStats = await sharp(bare[0]!.frames[0]!.png).stats();
    const armedStats = await sharp(armed[0]!.frames[0]!.png).stats();
    expect(armedStats.channels[3]!.mean).toBeGreaterThan(bareStats.channels[3]!.mean);
  });
});
