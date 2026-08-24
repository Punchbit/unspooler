import { describe, expect, it } from "vitest";
import { openai } from "../src/providers/openai.js";
import { fal } from "../src/providers/fal.js";
import { priceFor } from "../src/prices.js";
import type { ImageGenerator } from "../src/types.js";

describe("quality-aware prices", () => {
  it("prices gpt-image-2 by quality tier", () => {
    expect(priceFor("gpt-image-2")).toBe(0.053);
    expect(priceFor("gpt-image-2", 0.05, { quality: "low" })).toBe(0.006);
    expect(priceFor("gpt-image-2", 0.05, { quality: "medium" })).toBe(0.053);
    expect(priceFor("gpt-image-2", 0.05, { quality: "high" })).toBe(0.211);
    expect(priceFor("openai/gpt-image-2", 0.05, { quality: "low" })).toBe(0.006);
  });

  it("uses the low tier in openai and fal estimates", () => {
    const cheap = openai("gpt-image-2", { quality: "low" }) as ImageGenerator;
    const fancy = openai("gpt-image-2", { quality: "high" }) as ImageGenerator;
    expect(cheap.estimate?.({ prompt: "x" }).usd).toBe(0.006);
    expect(fancy.estimate?.({ prompt: "x" }).usd).toBe(0.211);
    expect(cheap.estimate?.({ prompt: "x" }).notes).toContain("low");

    const viaFal = fal("openai/gpt-image-2", { quality: "low" }) as ImageGenerator;
    expect(viaFal.estimate?.({ prompt: "x" }).usd).toBe(0.006);
  });
});
