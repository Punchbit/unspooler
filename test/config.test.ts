import { describe, expect, it } from "vitest";
import {
  defineConfig,
  directionsToGenerate,
  resolveAnimations,
  resolveDirections,
} from "../src/config.js";
import { chromaKey } from "../src/providers/chroma.js";

const base = {
  style: { prompt: "pixel art" },
  models: { matte: chromaKey() },
};

describe("config", () => {
  it("rejects empty assets", () => {
    expect(() => defineConfig({ ...base, assets: [] } as never)).toThrow();
  });

  it("defaults character animations and 4 directions", () => {
    const config = defineConfig({
      ...base,
      assets: [{ id: "hero", type: "character", prompt: "a knight" }],
    });
    const asset = config.assets[0]!;
    expect(resolveAnimations(config, asset).map((a) => a.name)).toEqual(["idle", "walk"]);
    expect(resolveDirections(asset)).toEqual(["down", "left", "right", "up"]);
    expect(directionsToGenerate(asset)).toEqual(["down", "left", "up"]);
  });

  it("skips animations for static and tileset assets", () => {
    const config = defineConfig({
      ...base,
      assets: [{ id: "cup", type: "static", prompt: "a cup" }],
    });
    expect(resolveAnimations(config, config.assets[0]!)).toEqual([]);
  });
});
