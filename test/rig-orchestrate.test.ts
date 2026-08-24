import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { defineConfig } from "../src/config.js";
import { unspool } from "../src/pipeline/orchestrate.js";
import { HUMANOID } from "../src/rig/skeleton.js";
import type { BackgroundRemover, ImageGenerator } from "../src/types.js";

/**
 * Fake image generator: returns a chroma-green parts sheet laid out on the
 * skeleton grid whenever the prompt asks for one, otherwise a plain subject.
 */
async function fakePartsSheet(): Promise<Buffer> {
  const { cols, rows, order } = HUMANOID.sheetLayout;
  const cell = 80;
  const composites: sharp.OverlayOptions[] = [];
  for (let i = 0; i < order.length; i++) {
    const share = HUMANOID.parts.find((p) => p.name === order[i]!)!.approxHeight;
    const w = Math.max(6, Math.round(share * 40));
    const h = Math.max(6, Math.round(share * 70));
    const blob = await sharp({
      create: { width: w, height: h, channels: 4, background: { r: 170, g: 60, b: 40, alpha: 1 } },
    })
      .png()
      .toBuffer();
    composites.push({
      input: blob,
      left: (i % cols) * cell + Math.round((cell - w) / 2),
      top: Math.floor(i / cols) * cell + Math.round((cell - h) / 2),
    });
  }
  return sharp({
    create: {
      width: cols * cell,
      height: rows * cell,
      channels: 3,
      background: { r: 0, g: 177, b: 64 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

async function fakeSubject(): Promise<Buffer> {
  const body = await sharp({
    create: { width: 30, height: 60, channels: 4, background: { r: 170, g: 60, b: 40, alpha: 1 } },
  })
    .png()
    .toBuffer();
  return sharp({
    create: { width: 96, height: 96, channels: 3, background: { r: 0, g: 177, b: 64 } },
  })
    .composite([{ input: body, left: 33, top: 20 }])
    .png()
    .toBuffer();
}

describe("skeletal character orchestration", () => {
  it("builds rig + atlas + baked sheet end to end with zero video calls", async () => {
    const partsSheet = await fakePartsSheet();
    const subject = await fakeSubject();
    const image: ImageGenerator = {
      kind: "image",
      id: "mock-image",
      estimate: () => ({ usd: 0, unit: "image" }),
      generate: async ({ prompt }) => ({
        images: [prompt.includes("body-parts sheet") ? partsSheet : subject],
        model: "mock",
      }),
    };
    const matte: BackgroundRemover = {
      kind: "matte",
      id: "chroma:mock",
      remove: async ({ frames }) => ({
        frames: await Promise.all(
          frames.map(async (f) => {
            // Key out the green backdrop.
            const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            for (let i = 0; i < data.length; i += 4) {
              if (data[i + 1]! > 120 && data[i]! < 90 && data[i + 2]! < 110) data[i + 3] = 0;
            }
            return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
              .png()
              .toBuffer();
          }),
        ),
        model: "mock",
      }),
    };

    const cwd = await mkdtemp(join(tmpdir(), "unspooler-rig-"));
    const config = defineConfig({
      style: { prompt: "test style", cellSize: 96 },
      models: { reference: image, matte },
      export: { outDir: "out", targets: ["generic", "godot", "css"] },
      assets: [
        {
          id: "hero",
          type: "character",
          prompt: "a hero",
          animations: ["idle", "walk"],
          directions: 4,
        },
      ],
    });

    const result = await unspool(config, { cwd, yes: true });
    expect(result.dryRun).toBe(false);
    const artifact = result.artifacts[0]!;
    expect(existsSync(artifact.rigPath!)).toBe(true);
    expect(existsSync(artifact.rigAtlasPath!)).toBe(true);
    expect(existsSync(artifact.sheetPath)).toBe(true);
    expect(existsSync(join(cwd, "out", "hero.rig.tscn"))).toBe(true);
    expect(existsSync(join(cwd, "out", "hero.rig.html"))).toBe(true);

    // The baked sheet holds idle + walk across 4 directions in 96px cells.
    const manifest = JSON.parse(
      await (await import("node:fs/promises")).readFile(artifact.manifestPath, "utf8"),
    );
    const tags = manifest.meta.frameTags.map((t: { name: string }) => t.name);
    expect(tags).toContain("idle-down");
    expect(tags).toContain("walk-right");
    expect(manifest.meta.cell).toEqual({ w: 96, h: 96 });

    // No video steps existed anywhere in the plan.
    expect(result.plan.steps.some((s) => s.stage === "video")).toBe(false);
  }, 60000);

  it("builds an equipment item into an atlas + manifest", async () => {
    const subject = await fakeSubject();
    const image: ImageGenerator = {
      kind: "image",
      id: "mock-image",
      estimate: () => ({ usd: 0, unit: "image" }),
      generate: async () => ({ images: [subject], model: "mock" }),
    };
    const matte: BackgroundRemover = {
      kind: "matte",
      id: "chroma:mock",
      remove: async ({ frames }) => ({
        frames: await Promise.all(
          frames.map(async (f) => {
            const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            for (let i = 0; i < data.length; i += 4) {
              if (data[i + 1]! > 120 && data[i]! < 90 && data[i + 2]! < 110) data[i + 3] = 0;
            }
            return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
              .png()
              .toBuffer();
          }),
        ),
        model: "mock",
      }),
    };

    const cwd = await mkdtemp(join(tmpdir(), "unspooler-equip-"));
    const config = defineConfig({
      style: { prompt: "test style", cellSize: 96 },
      models: { reference: image, matte },
      export: { outDir: "out", targets: ["generic"] },
      assets: [
        { id: "sword", type: "equipment", prompt: "an iron sword", slot: "hand.main" },
      ],
    });

    const result = await unspool(config, { cwd, yes: true });
    const artifact = result.artifacts[0]!;
    expect(existsSync(join(cwd, "out", "sword.equip.json"))).toBe(true);
    expect(existsSync(join(cwd, "out", "sword.equip.png"))).toBe(true);
    const manifest = JSON.parse(
      await (await import("node:fs/promises")).readFile(artifact.manifestPath, "utf8"),
    );
    expect(manifest.kind).toBe("equipment");
    expect(manifest.slot).toBe("hand.main");
    expect(manifest.mode).toBe("overlay");
    expect(Object.keys(manifest.facings)).toEqual(["down", "side", "up"]);
  }, 60000);
});
