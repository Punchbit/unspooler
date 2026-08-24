import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cssExporter } from "../src/exporters/css.js";
import { godotExporter } from "../src/exporters/godot.js";
import { phaserExporter } from "../src/exporters/phaser.js";
import type { SpriteManifest } from "../src/types.js";

const manifest: SpriteManifest = {
  frames: [
    {
      filename: "hero-walk-down-0.png",
      frame: { x: 0, y: 0, w: 32, h: 32 },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: 32, h: 32 },
      sourceSize: { w: 32, h: 32 },
      duration: 80,
      anchor: { x: 16, y: 32 },
      animation: "walk",
      direction: "down",
      index: 0,
    },
  ],
  meta: {
    app: "unspooler",
    version: "0.1.0",
    image: "hero.png",
    format: "RGBA8888",
    size: { w: 32, h: 32 },
    scale: "1",
    cell: { w: 32, h: 32 },
    fps: 12,
    assetId: "hero",
    assetType: "character",
    frameTags: [{ name: "walk-down", from: 0, to: 0, direction: "forward", loop: true }],
    anchors: { mode: "feet", x: 16, y: 32 },
  },
};

const asset = { id: "hero", type: "character" as const, prompt: "hero" };

describe("exporters", () => {
  it("writes phaser atlas + snippet", async () => {
    const dir = await mkdtemp(join(tmpdir(), "unspooler-"));
    const files = await phaserExporter.export({
      asset,
      manifest,
      sheet: Buffer.from("x"),
      sheetFileName: "hero.png",
      outDir: dir,
    });
    const atlas = JSON.parse(await readFile(files[0]!.path, "utf8"));
    expect(atlas.textures[0].image).toBe("hero.png");
    const snippet = await readFile(files[1]!.path, "utf8");
    expect(snippet).toContain("this.load.atlas");
  });

  it("writes a godot SpriteFrames resource", async () => {
    const dir = await mkdtemp(join(tmpdir(), "unspooler-"));
    const [file] = await godotExporter.export({
      asset,
      manifest,
      sheet: Buffer.from("x"),
      sheetFileName: "hero.png",
      outDir: dir,
    });
    const tres = await readFile(file!.path, "utf8");
    expect(tres).toContain("[gd_resource type=\"SpriteFrames\"");
    expect(tres).toContain("&\"walk-down\"");
  });

  it("writes a css player", async () => {
    const dir = await mkdtemp(join(tmpdir(), "unspooler-"));
    const files = await cssExporter.export({
      asset,
      manifest,
      sheet: Buffer.from("x"),
      sheetFileName: "hero.png",
      outDir: dir,
    });
    const css = await readFile(files[0]!.path, "utf8");
    expect(css).toContain(".hero-sprite");
  });
});
