import { describe, expect, it } from "vitest";
import {
  DEFAULT_INIT,
  parseChoice,
  parseList,
  promptInit,
  renderConfig,
  renderEnv,
} from "../src/init-template.js";

describe("init answers", () => {
  it("keeps defaults for empty / invalid choices", () => {
    expect(parseChoice("", ["fal", "replicate"], "fal")).toBe("fal");
    expect(parseChoice("2", ["fal", "replicate"], "fal")).toBe("replicate");
    expect(parseChoice("nano banana", ["fal", "openai", "gemini"], "fal")).toBe("gemini");
    expect(parseChoice("nope", ["fal", "replicate"], "fal")).toBe("fal");
    expect(parseList("", ["generic", "css"], ["generic", "phaser", "godot", "css"])).toEqual([
      "generic",
      "css",
    ]);
    expect(parseList("phaser, godot", ["generic"], ["generic", "phaser", "godot", "css"])).toEqual([
      "phaser",
      "godot",
    ]);
  });

  it("renders a fal + chroma draft config from defaults", () => {
    const src = renderConfig(DEFAULT_INIT);
    expect(src).toContain('from "unspooler"');
    expect(src).toContain("defineConfig");
    expect(src).toContain("fal(");
    expect(src).toContain("chromaKey()");
    expect(src).toContain('preset: "draft"');
    expect(src).toContain('"css"');
    expect(src).not.toContain("replicate(");
    expect(renderEnv(DEFAULT_INIT)).toContain("FAL_KEY=");
    expect(renderEnv(DEFAULT_INIT)).not.toContain("REPLICATE_API_TOKEN");
  });

  it("renders openai + nano banana + midjourney adapters", () => {
    expect(renderConfig({ ...DEFAULT_INIT, provider: "openai", videoProvider: "openai" })).toContain(
      'openai("gpt-image-2"',
    );
    expect(
      renderConfig({ ...DEFAULT_INIT, provider: "openai", videoProvider: "openai", preset: "draft" }),
    ).toContain('quality: "low"');
    expect(renderConfig({ ...DEFAULT_INIT, provider: "gemini", videoProvider: "gemini" })).toContain("nanoBanana()");
    expect(renderConfig({ ...DEFAULT_INIT, provider: "midjourney", videoProvider: "fal" })).toContain("midjourney()");
    expect(renderEnv({ ...DEFAULT_INIT, provider: "openai", videoProvider: "openai" })).toContain("OPENAI_API_KEY=");
    expect(renderEnv({ ...DEFAULT_INIT, provider: "gemini", videoProvider: "gemini" })).toContain("GEMINI_API_KEY=");
    expect(renderEnv({ ...DEFAULT_INIT, provider: "midjourney" })).toContain("MIDJOURNEY_API_KEY=");
  });

  it("renders replicate generation + BiRefNet when asked", () => {
    const src = renderConfig({
      ...DEFAULT_INIT,
      provider: "replicate",
      matte: "replicate",
      preset: "preferred",
      exportTargets: ["generic", "phaser", "godot"],
    });
    expect(src).toContain("replicate(");
    expect(src).toContain("sprited/birefnet");
    expect(src).toContain('"phaser"');
    expect(src).toContain('"godot"');
    expect(src).not.toContain("chromaKey");
    expect(renderEnv({ ...DEFAULT_INIT, provider: "replicate", matte: "replicate" })).toContain(
      "REPLICATE_API_TOKEN=",
    );
  });

  it("click-through (all empty answers) yields the defaults", async () => {
    const answers = await promptInit(async () => "");
    expect(answers).toEqual(DEFAULT_INIT);
  });
});
