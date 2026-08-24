import { afterEach, describe, expect, it, vi } from "vitest";
import { openai } from "../src/providers/openai.js";
import { gemini, nanoBanana } from "../src/providers/gemini.js";
import { midjourney } from "../src/providers/midjourney.js";
import type { ImageGenerator } from "../src/types.js";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.MIDJOURNEY_API_KEY;
});

describe("openai adapter", () => {
  it("decodes b64 images from /images/generations", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const gen = openai() as ImageGenerator;
    const result = await gen.generate({ prompt: "a knight" });
    expect(result.images[0]!.equals(png)).toBe(true);
    expect(result.model).toBe("gpt-image-2");
    expect(gen.id).toBe("openai:gpt-image-2");
  });
});

describe("gemini / nano banana", () => {
  it("reads inline image data from generateContent", async () => {
    process.env.GEMINI_API_KEY = "gem-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ inlineData: { data: png.toString("base64") } }] } }],
          }),
          { status: 200 },
        ),
      ),
    );
    const result = await nanoBanana().generate({ prompt: "a banana knight" });
    expect(result.images).toHaveLength(1);
    expect(gemini("gemini-3.1-flash-image").kind).toBe("image");
    expect(gemini("veo-3.1-generate-preview").kind).toBe("video");
  });
});

describe("midjourney adapter", () => {
  it("polls ImagineAPI until a URL is ready", async () => {
    process.env.MIDJOURNEY_API_KEY = "mj-test";
    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.endsWith("/items/images") && !href.includes("img-1")) {
        return new Response(JSON.stringify({ data: { id: "img-1" } }), { status: 200 });
      }
      if (href.includes("/items/images/img-1")) {
        return new Response(JSON.stringify({ data: { status: "completed", url: "https://cdn.example/hero.png" } }), {
          status: 200,
        });
      }
      if (href.includes("cdn.example")) {
        return new Response(png, { status: 200 });
      }
      return new Response("nope", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await midjourney().generate({ prompt: "pixel hero" });
    expect(result.images[0]!.equals(png)).toBe(true);
    expect(result.model).toBe("midjourney:imagineapi");
  });
});
