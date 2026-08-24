import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { normalizeFrames, pixelSnap } from "../src/pipeline/normalize.js";
import { packSheet } from "../src/pipeline/pack.js";
import { measureSeams } from "../src/pipeline/tileset.js";

async function blob(color: { r: number; g: number; b: number; alpha: number }, x: number, y: number) {
  const base = await sharp({
    create: { width: 64, height: 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
  const sprite = await sharp({
    create: { width: 12, height: 20, channels: 4, background: color },
  })
    .png()
    .toBuffer();
  return sharp(base)
    .composite([{ input: sprite, left: x, top: y }])
    .png()
    .toBuffer();
}

describe("normalize + pack", () => {
  it("locks every frame to the same foot baseline", async () => {
    const a = await blob({ r: 200, g: 40, b: 20, alpha: 1 }, 8, 40);
    const b = await blob({ r: 200, g: 40, b: 20, alpha: 1 }, 30, 20);
    const frames = await normalizeFrames([a, b], { cell: { w: 64, h: 80 }, mode: "feet" });
    expect(frames).toHaveLength(2);
    expect(frames[0]!.anchor.y).toBe(frames[1]!.anchor.y);
    expect(frames[0]!.anchor.x).toBe(32);

    const packed = await packSheet({
      asset: { id: "hero", type: "character", prompt: "x" },
      clips: [{ animation: "walk", direction: "down", loop: true, fps: 12, frames }],
      cell: { w: 64, h: 80 },
      fps: 12,
      anchorMode: "feet",
      imageName: "hero.png",
    });
    expect(packed.manifest.frames).toHaveLength(2);
    expect(packed.manifest.meta.frameTags[0]!.name).toBe("walk-down");
    const meta = await sharp(packed.sheet).metadata();
    expect(meta.width).toBe(128);
    expect(meta.height).toBe(80);
  });

  it("quantizes to a palette when pixel-snapping", async () => {
    const png = await sharp({
      create: { width: 32, height: 32, channels: 4, background: { r: 10, g: 200, b: 12, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const snapped = await pixelSnap(png, 16, ["#00ff00", "#000000"]);
    const { data } = await sharp(snapped).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBe(0);
    expect(data[1]).toBe(255);
    expect(data[2]).toBe(0);
  });

  it("reports a perfect seam on a flat tile", async () => {
    const tile = await sharp({
      create: { width: 16, height: 16, channels: 4, background: { r: 20, g: 80, b: 30, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const report = await measureSeams(tile);
    expect(report.ok).toBe(true);
    expect(report.score).toBe(0);
  });
});
