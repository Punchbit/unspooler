import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { defineConfig } from "../src/config.js";
import { unspool } from "../src/pipeline/orchestrate.js";
import { chromaKey } from "../src/providers/chroma.js";
import type { ImageGenerator } from "../src/types.js";

async function greenSubject(): Promise<Buffer> {
  const bg = await sharp({
    create: { width: 96, height: 96, channels: 3, background: { r: 0, g: 177, b: 64 } },
  })
    .png()
    .toBuffer();
  const body = await sharp({
    create: { width: 24, height: 40, channels: 4, background: { r: 180, g: 60, b: 30, alpha: 1 } },
  })
    .png()
    .toBuffer();
  return sharp(bg)
    .composite([{ input: body, left: 36, top: 30 }])
    .png()
    .toBuffer();
}

describe("static pipeline", () => {
  it("builds a static asset with mock image gen and chroma matte", async () => {
    const png = await greenSubject();
    const image: ImageGenerator = {
      kind: "image",
      id: "mock-image",
      estimate: () => ({ usd: 0, unit: "image" }),
      generate: async () => ({ images: [png], model: "mock" }),
    };
    const cwd = await mkdtemp(join(tmpdir(), "unspooler-proj-"));
    const config = defineConfig({
      style: { prompt: "test", cellSize: 64 },
      models: { reference: image, matte: chromaKey({ color: "green" }) },
      export: { outDir: "out", targets: ["generic"] },
      workDir: ".unspooler",
      assets: [{ id: "pot", type: "static", prompt: "a pot" }],
    });
    const result = await unspool(config, { cwd, yes: true });
    expect(result.dryRun).toBe(false);
    expect(result.artifacts).toHaveLength(1);
    const sheet = await sharp(result.artifacts[0]!.sheetPath).metadata();
    expect(sheet.width).toBeGreaterThan(0);
    expect(sheet.hasAlpha).toBe(true);
  });
});
