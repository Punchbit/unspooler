import { describe, expect, it } from "vitest";
import { defineConfig } from "../src/config.js";
import { planAsset, summarizePlan } from "../src/cost.js";
import { chromaKey } from "../src/providers/chroma.js";
import type { ImageGenerator, VideoGenerator } from "../src/types.js";

const image: ImageGenerator = {
  kind: "image",
  id: "test-image",
  estimate: () => ({ usd: 0.1, unit: "image" }),
  generate: async () => ({ images: [Buffer.from("x")], model: "test" }),
};

const video: VideoGenerator = {
  kind: "video",
  id: "test-video",
  estimate: () => ({ usd: 0.5, unit: "video" }),
  generate: async () => ({ video: Buffer.from("v"), model: "test" }),
};

describe("cost plan", () => {
  it("charges one video per generated facing, not mirrored ones", () => {
    const config = defineConfig({
      style: { prompt: "pixel" },
      models: { reference: image, video, matte: chromaKey() },
      assets: [
        {
          id: "hero",
          type: "character",
          prompt: "hero",
          animations: ["walk"],
          directions: 4,
        },
      ],
    });
    const plan = summarizePlan(planAsset(config, config.assets[0]!));
    const videos = plan.steps.filter((s) => s.stage === "video");
    expect(videos).toHaveLength(3);
    expect(plan.estimatedUsd).toBeGreaterThan(1);
    expect(plan.paidCalls).toBeGreaterThan(0);
  });

  it("skips the video stage for static assets", () => {
    const config = defineConfig({
      style: { prompt: "pixel" },
      models: { reference: image, video, matte: chromaKey() },
      assets: [{ id: "pot", type: "static", prompt: "a pot" }],
    });
    const steps = planAsset(config, config.assets[0]!);
    expect(steps.some((s) => s.stage === "video")).toBe(false);
    expect(steps.some((s) => s.stage === "reference")).toBe(true);
  });
});
