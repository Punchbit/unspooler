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
  it("charges one parts sheet per facing for skeletal characters, no video", () => {
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
    // 4 directions → 3 generated facings (down, side, up); right is mirrored.
    expect(plan.steps.filter((s) => s.stage === "parts")).toHaveLength(3);
    expect(plan.steps.filter((s) => s.stage === "video")).toHaveLength(0);
    expect(plan.steps.some((s) => s.stage === "fit")).toBe(true);
    expect(plan.steps.some((s) => s.stage === "bake")).toBe(true);
    // 1 reference + 3 parts sheets at $0.1 each.
    expect(plan.estimatedUsd).toBeCloseTo(0.4, 5);
    expect(plan.paidCalls).toBeGreaterThan(0);
  });

  it("only generates the down facing for single-direction characters", () => {
    const config = defineConfig({
      style: { prompt: "pixel" },
      models: { reference: image, video, matte: chromaKey() },
      assets: [{ id: "npc", type: "character", prompt: "npc", directions: 1 }],
    });
    const steps = planAsset(config, config.assets[0]!);
    expect(steps.filter((s) => s.stage === "parts")).toHaveLength(1);
  });

  it("plans per-facing art + local fit for equipment", () => {
    const config = defineConfig({
      style: { prompt: "pixel" },
      models: { reference: image, video, matte: chromaKey() },
      assets: [
        { id: "sword", type: "equipment", prompt: "an iron sword", slot: "hand.main" },
      ],
    });
    const steps = planAsset(config, config.assets[0]!);
    expect(steps.filter((s) => s.stage === "parts")).toHaveLength(3);
    expect(steps.some((s) => s.stage === "video")).toBe(false);
    expect(steps.some((s) => s.stage === "fit")).toBe(true);
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
