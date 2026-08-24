import { defineConfig, fal, chromaKey } from "../src/index.ts";

export default defineConfig({
  style: {
    prompt: "16-bit SNES JRPG pixel art, crisp clean pixels",
    palette: ["#1b1b1e", "#f4efe4", "#c45c26", "#3d6b4f"],
    cellSize: 128,
    pixelNative: 32,
  },
  preset: "draft",
  models: {
    reference: fal("fal-ai/flux/schnell"),
    video: fal("fal-ai/kling-video/v2.1/standard/image-to-video"),
    matte: chromaKey(),
  },
  assets: [
    {
      id: "hero",
      type: "character",
      prompt: "a cloaked adventurer",
      animations: ["idle", "walk"],
      directions: 4,
    },
    {
      id: "potion",
      type: "static",
      prompt: "a small red health potion bottle",
    },
    {
      id: "grass",
      type: "tileset",
      prompt: "seamless grassy dirt tile",
      tileSize: 32,
    },
  ],
});
