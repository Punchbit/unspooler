import { guessImageMime, toBuffer } from "../media.js";
import { priceFor } from "../prices.js";
import type {
  CostEstimate,
  ImageGenInput,
  ImageGenResult,
  ImageGenerator,
  VideoGenInput,
  VideoGenResult,
  VideoGenerator,
} from "../types.js";
import { pollUntil, readHttpError } from "./poll.js";

export interface GeminiOptions {
  kind?: "image" | "video";
  apiKey?: string;
  baseUrl?: string;
  usdPerCall?: number;
  input?: Record<string, unknown>;
}

/** Nano Banana 2 — Gemini 3.1 Flash Image. */
export const NANO_BANANA_MODEL = "gemini-3.1-flash-image";
const DEFAULT_VIDEO = "veo-3.1-generate-preview";

function key(apiKey?: string): string {
  const value = apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!value) throw new Error("gemini adapter needs GEMINI_API_KEY (or GOOGLE_API_KEY).");
  return value;
}

function root(baseUrl?: string): string {
  return (baseUrl ?? process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta").replace(
    /\/$/,
    "",
  );
}

function inferKind(model: string, kind?: "image" | "video"): "image" | "video" {
  if (kind) return kind;
  return /veo|video/i.test(model) ? "video" : "image";
}

function decodeInline(part: unknown): Buffer | null {
  if (!part || typeof part !== "object") return null;
  const obj = part as Record<string, unknown>;
  const inline = (obj.inlineData ?? obj.inline_data) as Record<string, unknown> | undefined;
  const data = inline?.data;
  return typeof data === "string" ? Buffer.from(data, "base64") : null;
}

export function geminiImage(model = NANO_BANANA_MODEL, options: GeminiOptions = {}): ImageGenerator {
  return {
    kind: "image",
    id: `gemini:${model}`,
    estimate(input: ImageGenInput): CostEstimate {
      const takes = input.takes ?? 1;
      return {
        usd: (options.usdPerCall ?? priceFor(model, 0.04)) * takes,
        unit: `${takes} image(s)`,
        notes: `${model} (nano banana)`,
      };
    },
    async generate(input: ImageGenInput): Promise<ImageGenResult> {
      const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];
      for (const ref of input.references ?? []) {
        const buf = await toBuffer(ref);
        parts.push({
          inline_data: { mime_type: guessImageMime(buf), data: buf.toString("base64") },
        });
      }
      const images: Buffer[] = [];
      const takes = input.takes ?? 1;
      for (let i = 0; i < takes; i++) {
        const res = await fetch(
          `${root(options.baseUrl)}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key(options.apiKey))}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
              ...options.input,
            }),
          },
        );
        if (!res.ok) throw new Error(`gemini ${model} failed: ${await readHttpError(res)}`);
        const json = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: unknown[] } }>;
        };
        const found = json.candidates?.[0]?.content?.parts?.map(decodeInline).find(Boolean);
        if (!found) throw new Error(`gemini ${model} returned no image`);
        images.push(found);
      }
      return { images, model };
    },
  };
}

export function geminiVideo(model = DEFAULT_VIDEO, options: GeminiOptions = {}): VideoGenerator {
  return {
    kind: "video",
    id: `gemini:${model}`,
    estimate(): CostEstimate {
      return { usd: options.usdPerCall ?? priceFor(model, 0.35), unit: "video", notes: model };
    },
    async generate(input: VideoGenInput): Promise<VideoGenResult> {
      const image = await toBuffer(input.image);
      const res = await fetch(
        `${root(options.baseUrl)}/models/${encodeURIComponent(model)}:predictLongRunning?key=${encodeURIComponent(key(options.apiKey))}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            instances: [
              {
                prompt: input.prompt,
                image: { bytesBase64Encoded: image.toString("base64"), mimeType: guessImageMime(image) },
              },
            ],
            ...options.input,
          }),
        },
      );
      if (!res.ok) throw new Error(`gemini ${model} failed: ${await readHttpError(res)}`);
      const started = (await res.json()) as { name?: string };
      if (!started.name) throw new Error(`gemini ${model} returned no operation name`);

      const video = await pollUntil(
        async () => {
          const poll = await fetch(
            `${root(options.baseUrl)}/${started.name}?key=${encodeURIComponent(key(options.apiKey))}`,
          );
          if (!poll.ok) throw new Error(`gemini ${model} poll failed: ${await readHttpError(poll)}`);
          const body = (await poll.json()) as {
            done?: boolean;
            error?: { message?: string };
            response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> } };
          };
          if (body.error) throw new Error(`gemini ${model} failed: ${body.error.message ?? "unknown error"}`);
          const uri = body.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
          if (body.done && uri) {
            const file = await fetch(uri.includes("key=") ? uri : `${uri}${uri.includes("?") ? "&" : "?"}key=${key(options.apiKey)}`);
            if (!file.ok) throw new Error(`gemini ${model} download failed: ${await readHttpError(file)}`);
            return { done: true, value: Buffer.from(await file.arrayBuffer()), status: "done" };
          }
          return { done: false, status: body.done ? "missing-uri" : "running" };
        },
        { label: `gemini ${model}`, intervalMs: 5000 },
      );
      return { video, contentType: "video/mp4", model };
    },
  };
}

export function gemini(model?: string, options: GeminiOptions = {}): ImageGenerator | VideoGenerator {
  const id = model ?? (options.kind === "video" ? DEFAULT_VIDEO : NANO_BANANA_MODEL);
  return inferKind(id, options.kind) === "video" ? geminiVideo(id, options) : geminiImage(id, options);
}

/** Alias for Gemini image generation (Nano Banana / Nano Banana 2). */
export function nanoBanana(options: GeminiOptions = {}): ImageGenerator {
  return geminiImage(NANO_BANANA_MODEL, options);
}
