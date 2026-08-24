import { priceFor } from "../prices.js";
import { downloadToBuffer, guessImageMime, toBuffer, toDataUrl } from "../media.js";
import type {
  CostEstimate,
  ImageGenInput,
  ImageGenResult,
  ImageGenerator,
  VideoGenInput,
  VideoGenResult,
  VideoGenerator,
} from "../types.js";

export interface FalOptions {
  kind?: "image" | "video";
  apiKey?: string;
  usdPerCall?: number;
  quality?: "low" | "medium" | "high" | "auto";
  input?: Record<string, unknown>;
}

function inferKind(model: string, kind?: "image" | "video"): "image" | "video" {
  if (kind) return kind;
  return /video|i2v|image-to-video|wan|kling|seedance|runway|luma|veo/i.test(model)
    ? "video"
    : "image";
}

async function falClient(apiKey?: string) {
  const { fal } = await import("@fal-ai/client");
  const key = apiKey ?? process.env.FAL_KEY ?? process.env.FAL_API_KEY;
  if (!key) {
    throw new Error(
      "fal adapter needs FAL_KEY (or FAL_API_KEY). Set the env var or pass { apiKey }.",
    );
  }
  fal.config({ credentials: key });
  return fal;
}

function firstUrl(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string" && /^https?:\/\//.test(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstUrl(item);
      if (found) return found;
    }
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["url", "image_url", "video_url", "file_url"]) {
      if (typeof obj[key] === "string") return obj[key] as string;
    }
    for (const nested of Object.values(obj)) {
      const found = firstUrl(nested);
      if (found) return found;
    }
  }
  return null;
}

function collectUrls(value: unknown, into: string[] = []): string[] {
  if (!value) return into;
  if (typeof value === "string" && /^https?:\/\//.test(value)) {
    into.push(value);
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, into);
    return into;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.url === "string") into.push(obj.url);
    else for (const nested of Object.values(obj)) collectUrls(nested, into);
  }
  return into;
}

export function falImage(model: string, options: FalOptions = {}): ImageGenerator {
  return {
    kind: "image",
    id: `fal:${model}`,
    estimate(input: ImageGenInput): CostEstimate {
      const takes = input.takes ?? 1;
      const quality =
        options.quality ?? (typeof options.input?.quality === "string" ? options.input.quality : undefined);
      const usd = (options.usdPerCall ?? priceFor(model, 0.08, { quality })) * takes;
      return { usd, unit: `${takes} image(s)`, notes: quality ? `${model} ${quality}` : model };
    },
    async generate(input: ImageGenInput): Promise<ImageGenResult> {
      const fal = await falClient(options.apiKey);
      const refs = input.references?.length
        ? await Promise.all(
            input.references.map(async (ref) => {
              const buf = await toBuffer(ref);
              return toDataUrl(buf, guessImageMime(buf));
            }),
          )
        : [];

      const endpoint = refs.length && !model.endsWith("/edit") ? `${model}/edit` : model;
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        num_images: input.takes ?? 1,
        ...(options.quality ? { quality: options.quality } : {}),
        ...options.input,
      };
      if (input.width && input.height) {
        payload.image_size = { width: input.width, height: input.height };
      }
      if (refs.length) {
        payload.image_urls = refs;
        payload.image_url = refs[0];
      }

      const result = await fal.subscribe(endpoint, { input: payload });
      const urls = collectUrls(result.data);
      if (!urls.length) {
        throw new Error(`fal ${endpoint} returned no image URL. Raw: ${JSON.stringify(result.data).slice(0, 400)}`);
      }
      const images = await Promise.all(urls.map(downloadToBuffer));
      return { images, model: endpoint };
    },
  };
}

export function falVideo(model: string, options: FalOptions = {}): VideoGenerator {
  return {
    kind: "video",
    id: `fal:${model}`,
    estimate(): CostEstimate {
      return {
        usd: options.usdPerCall ?? priceFor(model, 0.2),
        unit: "video",
        notes: model,
      };
    },
    async generate(input: VideoGenInput): Promise<VideoGenResult> {
      const fal = await falClient(options.apiKey);
      const image = await toBuffer(input.image);
      const imageUrl = toDataUrl(image, guessImageMime(image));
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        image_url: imageUrl,
        duration: input.duration ?? 5,
        ...options.input,
      };
      const result = await fal.subscribe(model, { input: payload });
      const url = firstUrl(result.data);
      if (!url) {
        throw new Error(`fal ${model} returned no video URL. Raw: ${JSON.stringify(result.data).slice(0, 400)}`);
      }
      return { video: await downloadToBuffer(url), contentType: "video/mp4", model };
    },
  };
}

/**
 * Preferred fal adapter. Infers image vs video from the model id
 * (override with `{ kind: "video" }` if the name is ambiguous).
 */
export function fal(model: string, options: FalOptions = {}): ImageGenerator | VideoGenerator {
  return inferKind(model, options.kind) === "video"
    ? falVideo(model, options)
    : falImage(model, options);
}
