import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { applyLoopWindow, dedupeFrames, detectLoopWindow } from "../src/pipeline/frames.js";

async function solid(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({
    create: { width: 8, height: 8, channels: 3, background: { r, g, b } },
  })
    .png()
    .toBuffer();
}

describe("frame selection", () => {
  it("drops near-duplicate consecutive frames", async () => {
    const a = await solid(10, 10, 10);
    const b = await solid(10, 10, 11);
    const c = await solid(200, 10, 10);
    const kept = await dedupeFrames([a, b, c], 20);
    expect(kept).toHaveLength(2);
  });

  it("picks a loop window whose ends match", async () => {
    const red = await solid(200, 0, 0);
    const blue = await solid(0, 0, 200);
    const frames = [red, blue, blue, blue, blue, blue, red];
    const window = await detectLoopWindow(frames, 4);
    const looped = applyLoopWindow(frames, window);
    expect(looped.length).toBeGreaterThanOrEqual(4);
    expect(window.in).toBe(0);
    expect(window.out).toBe(6);
  });
});
