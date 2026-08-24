import { downloadToBuffer, guessImageMime, toBuffer, toDataUrl } from "../media.js";
import { priceFor } from "../prices.js";
import type {
  BackgroundRemover,
  ImageGenInput,
  ImageGenResult,
  ImageGenerator,
  MatteInput,
  MatteResult,
  VideoGenInput,
  VideoGenResult,
  VideoGenerator,
} from "../types.js";

export interface HttpProviderOptions {
  endpoint: string;
  headers?: Record<string, string>;
  usdPerCall?: number;
  id?: string;
  mapRequest?: (body: Record<string, unknown>) => Record<string, unknown>;
  mapResponseUrl?: (json: unknown) => string | string[];
}

async function postJson(opts: HttpProviderOptions, body: Record<string, unknown>): Promise<unknown> {
  const payload = opts.mapRequest ? opts.mapRequest(body) : body;
  const res = await fetch(opts.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", ...opts.headers },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`HTTP provider ${opts.endpoint} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

function urlsFrom(json: unknown, map?: HttpProviderOptions["mapResponseUrl"]): string[] {
  if (map) {
    const mapped = map(json);
    return Array.isArray(mapped) ? mapped : [mapped];
  }
  if (typeof json === "string") return [json];
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    for (const key of ["url", "image", "video", "output"]) {
      if (typeof obj[key] === "string") return [obj[key] as string];
      if (Array.isArray(obj[key])) return (obj[key] as unknown[]).filter((x): x is string => typeof x === "string");
    }
  }
  throw new Error("HTTP provider response had no URL. Supply mapResponseUrl().");
}

/** Point any stage at a custom HTTP endpoint (ComfyUI wrapper, your API, etc.). */
export function httpImage(options: HttpProviderOptions): ImageGenerator {
  return {
    kind: "image",
    id: options.id ?? `http:${options.endpoint}`,
    estimate: (input) => ({
      usd: (options.usdPerCall ?? 0) * (input.takes ?? 1),
      unit: "image",
    }),
    async generate(input: ImageGenInput): Promise<ImageGenResult> {
      const json = await postJson(options, { prompt: input.prompt, takes: input.takes ?? 1 });
      const urls = urlsFrom(json, options.mapResponseUrl);
      return { images: await Promise.all(urls.map(downloadToBuffer)), model: options.endpoint };
    },
  };
}

export function httpVideo(options: HttpProviderOptions): VideoGenerator {
  return {
    kind: "video",
    id: options.id ?? `http:${options.endpoint}`,
    estimate: () => ({ usd: options.usdPerCall ?? 0, unit: "video" }),
    async generate(input: VideoGenInput): Promise<VideoGenResult> {
      const image = await toBuffer(input.image);
      const json = await postJson(options, {
        prompt: input.prompt,
        image: toDataUrl(image, guessImageMime(image)),
      });
      const url = urlsFrom(json, options.mapResponseUrl)[0]!;
      return { video: await downloadToBuffer(url), model: options.endpoint };
    },
  };
}

export function httpMatte(options: HttpProviderOptions): BackgroundRemover {
  return {
    kind: "matte",
    id: options.id ?? `http:${options.endpoint}`,
    estimate: (input) => ({
      usd: (options.usdPerCall ?? priceFor("custom-matte", 0)) * input.frames.length,
      unit: "frame",
    }),
    async remove(input: MatteInput): Promise<MatteResult> {
      const frames: Buffer[] = [];
      for (const frame of input.frames) {
        const json = await postJson(options, { image: toDataUrl(frame, "image/png") });
        const url = urlsFrom(json, options.mapResponseUrl)[0]!;
        frames.push(await downloadToBuffer(url));
      }
      return { frames, model: options.endpoint };
    },
  };
}
