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

export interface OpenAIOptions {
  kind?: "image" | "video";
  apiKey?: string;
  baseUrl?: string;
  usdPerCall?: number;
  /** gpt-image-2: low is much cheaper than medium/high. Default medium. */
  quality?: "low" | "medium" | "high" | "auto";
  input?: Record<string, unknown>;
}

export const DEFAULT_OPENAI_IMAGE = "gpt-image-2";
const DEFAULT_VIDEO = "sora-2";

function key(apiKey?: string): string {
  const value = apiKey ?? process.env.OPENAI_API_KEY;
  if (!value) throw new Error("openai adapter needs OPENAI_API_KEY.");
  return value;
}

function root(baseUrl?: string): string {
  return (baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
}

function inferKind(model: string, kind?: "image" | "video"): "image" | "video" {
  if (kind) return kind;
  return /sora|video/i.test(model) ? "video" : "image";
}

function sizeFor(width?: number, height?: number): string {
  if (!width || !height) return "1024x1024";
  if (width === height) return "1024x1024";
  return width > height ? "1536x1024" : "1024x1536";
}

function resolvedQuality(options: OpenAIOptions): OpenAIOptions["quality"] {
  const fromInput = options.input?.quality;
  if (typeof fromInput === "string") return fromInput as OpenAIOptions["quality"];
  return options.quality ?? "medium";
}

export function openaiImage(model = DEFAULT_OPENAI_IMAGE, options: OpenAIOptions = {}): ImageGenerator {
  return {
    kind: "image",
    id: `openai:${model}`,
    estimate(input: ImageGenInput): CostEstimate {
      const takes = input.takes ?? 1;
      const quality = resolvedQuality(options);
      const each = options.usdPerCall ?? priceFor(model, 0.053, { quality });
      return {
        usd: each * takes,
        unit: `${takes} image(s)`,
        notes: quality ? `${model} ${quality}` : model,
      };
    },
    async generate(input: ImageGenInput): Promise<ImageGenResult> {
      const headers: Record<string, string> = { authorization: `Bearer ${key(options.apiKey)}` };
      const n = input.takes ?? 1;
      const quality = resolvedQuality(options);
      let res: Response;
      if (input.references?.length) {
        const form = new FormData();
        form.set("model", model);
        form.set("prompt", input.prompt);
        form.set("n", String(n));
        if (quality) form.set("quality", quality);
        for (const [i, ref] of input.references.entries()) {
          const buf = await toBuffer(ref);
          form.append("image[]", new Blob([new Uint8Array(buf)], { type: guessImageMime(buf) }), `ref-${i}.png`);
        }
        for (const [k, v] of Object.entries(options.input ?? {})) form.set(k, String(v));
        res = await fetch(`${root(options.baseUrl)}/images/edits`, { method: "POST", headers, body: form });
      } else {
        headers["content-type"] = "application/json";
        res = await fetch(`${root(options.baseUrl)}/images/generations`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            prompt: input.prompt,
            n,
            size: sizeFor(input.width, input.height),
            quality,
            ...options.input,
          }),
        });
      }
      if (!res.ok) throw new Error(`openai ${model} failed: ${await readHttpError(res)}`);
      const json = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
      const images = await Promise.all(
        (json.data ?? []).map((item) => {
          if (item.b64_json) return Buffer.from(item.b64_json, "base64");
          if (item.url) return download(item.url);
          throw new Error(`openai ${model} returned no image payload`);
        }),
      );
      if (!images.length) throw new Error(`openai ${model} returned no images`);
      return { images, model };
    },
  };
}

export function openaiVideo(model = DEFAULT_VIDEO, options: OpenAIOptions = {}): VideoGenerator {
  return {
    kind: "video",
    id: `openai:${model}`,
    estimate(): CostEstimate {
      return { usd: options.usdPerCall ?? priceFor(model, 0.5), unit: "video", notes: model };
    },
    async generate(input: VideoGenInput): Promise<VideoGenResult> {
      const image = await toBuffer(input.image);
      const form = new FormData();
      form.set("model", model);
      form.set("prompt", input.prompt);
      if (input.duration) form.set("seconds", String(Math.round(input.duration)));
      form.set("input_reference", new Blob([new Uint8Array(image)], { type: guessImageMime(image) }), "reference.png");
      for (const [k, v] of Object.entries(options.input ?? {})) form.set(k, String(v));

      const started = await fetch(`${root(options.baseUrl)}/videos`, {
        method: "POST",
        headers: { authorization: `Bearer ${key(options.apiKey)}` },
        body: form,
      });
      if (!started.ok) throw new Error(`openai ${model} failed: ${await readHttpError(started)}`);
      const job = (await started.json()) as { id?: string; status?: string };
      if (!job.id) throw new Error(`openai ${model} returned no video job id`);

      const videoId = await pollUntil(
        async () => {
          const poll = await fetch(`${root(options.baseUrl)}/videos/${job.id}`, {
            headers: { authorization: `Bearer ${key(options.apiKey)}` },
          });
          if (!poll.ok) throw new Error(`openai ${model} poll failed: ${await readHttpError(poll)}`);
          const body = (await poll.json()) as { status?: string; error?: { message?: string } };
          if (body.status === "failed") {
            throw new Error(`openai ${model} failed: ${body.error?.message ?? "unknown error"}`);
          }
          return { done: body.status === "completed", value: job.id, status: body.status };
        },
        { label: `openai ${model}`, intervalMs: 4000 },
      );

      const content = await fetch(`${root(options.baseUrl)}/videos/${videoId}/content`, {
        headers: { authorization: `Bearer ${key(options.apiKey)}` },
      });
      if (!content.ok) throw new Error(`openai ${model} download failed: ${await readHttpError(content)}`);
      return { video: Buffer.from(await content.arrayBuffer()), contentType: "video/mp4", model };
    },
  };
}

export function openai(
  model?: string,
  options: OpenAIOptions = {},
): ImageGenerator | VideoGenerator {
  const id = model ?? (options.kind === "video" ? DEFAULT_VIDEO : DEFAULT_OPENAI_IMAGE);
  return inferKind(id, options.kind) === "video" ? openaiVideo(id, options) : openaiImage(id, options);
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`openai download failed: ${await readHttpError(res)}`);
  return Buffer.from(await res.arrayBuffer());
}
