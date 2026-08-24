import { priceFor } from "../prices.js";
import { downloadToBuffer, guessImageMime, toBuffer, toDataUrl } from "../media.js";
import type {
  BackgroundRemover,
  CostEstimate,
  ImageGenInput,
  ImageGenResult,
  ImageGenerator,
  MatteInput,
  MatteResult,
  VideoGenInput,
  VideoGenResult,
  VideoGenerator,
} from "../types.js";

export interface ReplicateOptions {
  kind?: "image" | "video" | "matte";
  apiToken?: string;
  usdPerCall?: number;
  variant?: string;
  input?: Record<string, unknown>;
}

function inferKind(model: string, kind?: ReplicateOptions["kind"]): ReplicateOptions["kind"] {
  if (kind) return kind;
  if (/birefnet|rmbg|rembg|background|matte|ben[-_]?v/i.test(model)) return "matte";
  if (/video|i2v|kling|wan|seedance/i.test(model)) return "video";
  return "image";
}

async function client(apiToken?: string) {
  const Replicate = (await import("replicate")).default;
  const token = apiToken ?? process.env.REPLICATE_API_TOKEN;
  if (!token) {
    throw new Error("replicate adapter needs REPLICATE_API_TOKEN.");
  }
  return new Replicate({ auth: token });
}

function outputUrls(output: unknown): string[] {
  if (!output) return [];
  if (typeof output === "string") return [output];
  if (Array.isArray(output)) return output.flatMap(outputUrls);
  if (typeof output === "object" && output !== null) {
    const obj = output as Record<string, unknown>;
    if (typeof obj.url === "function") {
      try {
        const url = (obj as { url: () => string }).url();
        if (typeof url === "string") return [url];
      } catch {
        /* ignore */
      }
    }
    if (typeof obj.href === "string") return [obj.href];
    return Object.values(obj).flatMap(outputUrls);
  }
  return [];
}

export function replicateImage(model: string, options: ReplicateOptions = {}): ImageGenerator {
  return {
    kind: "image",
    id: `replicate:${model}`,
    estimate(input: ImageGenInput): CostEstimate {
      const takes = input.takes ?? 1;
      return {
        usd: (options.usdPerCall ?? priceFor(model, 0.04)) * takes,
        unit: `${takes} image(s)`,
        notes: model,
      };
    },
    async generate(input: ImageGenInput): Promise<ImageGenResult> {
      const replicate = await client(options.apiToken);
      const output = await replicate.run(model as `${string}/${string}`, {
        input: { prompt: input.prompt, ...options.input },
      });
      const urls = outputUrls(output);
      if (!urls.length) throw new Error(`replicate ${model} returned no image`);
      return { images: await Promise.all(urls.map(downloadToBuffer)), model };
    },
  };
}

export function replicateVideo(model: string, options: ReplicateOptions = {}): VideoGenerator {
  return {
    kind: "video",
    id: `replicate:${model}`,
    estimate(): CostEstimate {
      return { usd: options.usdPerCall ?? priceFor(model, 0.15), unit: "video", notes: model };
    },
    async generate(input: VideoGenInput): Promise<VideoGenResult> {
      const replicate = await client(options.apiToken);
      const image = await toBuffer(input.image);
      const output = await replicate.run(model as `${string}/${string}`, {
        input: {
          prompt: input.prompt,
          image: toDataUrl(image, guessImageMime(image)),
          ...options.input,
        },
      });
      const url = outputUrls(output)[0];
      if (!url) throw new Error(`replicate ${model} returned no video`);
      return { video: await downloadToBuffer(url), model };
    },
  };
}

export function replicateMatte(model: string, options: ReplicateOptions = {}): BackgroundRemover {
  return {
    kind: "matte",
    id: `replicate:${model}`,
    estimate(input: MatteInput): CostEstimate {
      const n = input.frames.length || 1;
      return {
        usd: (options.usdPerCall ?? priceFor(model, 0.004)) * n,
        unit: `${n} frame(s)`,
        notes: `${model}${options.variant ? ` (${options.variant})` : ""}`,
      };
    },
    async remove(input: MatteInput): Promise<MatteResult> {
      const replicate = await client(options.apiToken);
      const frames: Buffer[] = [];
      for (const frame of input.frames) {
        const output = await replicate.run(model as `${string}/${string}`, {
          input: {
            image: toDataUrl(frame, "image/png"),
            variant: input.variant ?? options.variant ?? "toonout",
            output_format: "cutout",
            refine_fg: true,
            ...options.input,
          },
        });
        const url = outputUrls(output)[0];
        if (!url) throw new Error(`replicate ${model} returned no matte`);
        frames.push(await downloadToBuffer(url));
      }
      return { frames, model };
    },
  };
}

export function replicate(
  model: string,
  options: ReplicateOptions = {},
): ImageGenerator | VideoGenerator | BackgroundRemover {
  const kind = inferKind(model, options.kind);
  if (kind === "video") return replicateVideo(model, options);
  if (kind === "matte") return replicateMatte(model, options);
  return replicateImage(model, options);
}
