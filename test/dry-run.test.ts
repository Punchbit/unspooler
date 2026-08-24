import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defineConfig } from "../src/config.js";
import { unspool } from "../src/pipeline/orchestrate.js";
import { chromaKey } from "../src/providers/chroma.js";
import type { ImageGenerator, VideoGenerator } from "../src/types.js";

const image: ImageGenerator = {
  kind: "image",
  id: "paid-image",
  estimate: () => ({ usd: 0.5, unit: "image" }),
  generate: async () => {
    throw new Error("should not generate on dry-run");
  },
};

const video: VideoGenerator = {
  kind: "video",
  id: "paid-video",
  estimate: () => ({ usd: 1.2, unit: "video" }),
  generate: async () => {
    throw new Error("should not generate on dry-run");
  },
};

describe("dry-run", () => {
  it("returns a costed plan and does not call providers", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "unspooler-dry-"));
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
    const result = await unspool(config, { cwd, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.artifacts).toEqual([]);
    expect(result.plan.estimatedUsd).toBeGreaterThan(0);
    // Skeletal characters generate parts sheets, never video.
    expect(result.plan.steps.some((s) => s.stage === "parts")).toBe(true);
    expect(result.plan.steps.some((s) => s.stage === "video")).toBe(false);
  });
});
