import { guessImageMime, toBuffer } from "../media.js";
import { priceFor } from "../prices.js";
import type {
  CostEstimate,
  ImageGenInput,
  ImageGenResult,
  ImageGenerator,
} from "../types.js";
import { pollUntil, readHttpError } from "./poll.js";

export type MidjourneyBackend = "imagineapi" | "useapi" | "custom";

export interface MidjourneyOptions {
  /** Midjourney has no official API. Pick a gateway, or pass a custom base URL. */
  backend?: MidjourneyBackend;
  apiKey?: string;
  baseUrl?: string;
  usdPerCall?: number;
  version?: string;
}

/**
 * Midjourney still has no official public API. This adapter talks to a third-party
 * gateway. Defaults to ImagineAPI; set `backend: "useapi"` or a custom `baseUrl`.
 *
 * Env: MIDJOURNEY_API_KEY, optional MIDJOURNEY_BASE_URL / MIDJOURNEY_BACKEND.
 */
export function midjourney(options: MidjourneyOptions = {}): ImageGenerator {
  const backend = (options.backend ?? process.env.MIDJOURNEY_BACKEND ?? "imagineapi") as MidjourneyBackend;
  const baseUrl = (
    options.baseUrl ??
    process.env.MIDJOURNEY_BASE_URL ??
    (backend === "useapi" ? "https://api.useapi.net/v3" : "https://cl.imagineapi.dev")
  ).replace(/\/$/, "");

  return {
    kind: "image",
    id: `midjourney:${backend}`,
    estimate(input: ImageGenInput): CostEstimate {
      const takes = input.takes ?? 1;
      return {
        usd: (options.usdPerCall ?? priceFor("midjourney", 0.08)) * takes,
        unit: `${takes} image(s)`,
        notes: `midjourney via ${backend} (no official API)`,
      };
    },
    async generate(input: ImageGenInput): Promise<ImageGenResult> {
      const token = options.apiKey ?? process.env.MIDJOURNEY_API_KEY;
      if (!token) throw new Error("midjourney adapter needs MIDJOURNEY_API_KEY for the ImagineAPI/useapi gateway.");
      const images: Buffer[] = [];
      const takes = input.takes ?? 1;
      for (let i = 0; i < takes; i++) {
        images.push(
          backend === "useapi"
            ? await generateUseApi(baseUrl, token, input, options)
            : await generateImagineApi(baseUrl, token, input, options),
        );
      }
      return { images, model: `midjourney:${backend}` };
    },
  };
}

async function generateImagineApi(
  baseUrl: string,
  token: string,
  input: ImageGenInput,
  options: MidjourneyOptions,
): Promise<Buffer> {
  const prompt = buildPrompt(input, options);
  const started = await fetch(`${baseUrl}/items/images`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ prompt }),
  });
  if (!started.ok) throw new Error(`midjourney imagineapi failed: ${await readHttpError(started)}`);
  const created = (await started.json()) as { data?: { id?: string } };
  const id = created.data?.id;
  if (!id) throw new Error("midjourney imagineapi returned no job id");

  const url = await pollUntil(
    async () => {
      const poll = await fetch(`${baseUrl}/items/images/${id}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!poll.ok) throw new Error(`midjourney imagineapi poll failed: ${await readHttpError(poll)}`);
      const body = (await poll.json()) as {
        data?: { status?: string; url?: string; error?: string };
      };
      const status = body.data?.status ?? "";
      if (status === "failed") throw new Error(`midjourney imagineapi failed: ${body.data?.error ?? "unknown"}`);
      if ((status === "completed" || status === "done") && body.data?.url) {
        return { done: true, value: body.data.url, status };
      }
      return { done: false, status };
    },
    { label: "midjourney imagineapi", intervalMs: 4000 },
  );
  return download(url);
}

async function generateUseApi(
  baseUrl: string,
  token: string,
  input: ImageGenInput,
  options: MidjourneyOptions,
): Promise<Buffer> {
  const body: Record<string, unknown> = { prompt: buildPrompt(input, options) };
  if (input.references?.[0]) {
    const buf = await toBuffer(input.references[0]);
    body.image = `data:${guessImageMime(buf)};base64,${buf.toString("base64")}`;
  }
  const started = await fetch(`${baseUrl}/midjourney/jobs`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!started.ok) throw new Error(`midjourney useapi failed: ${await readHttpError(started)}`);
  const created = (await started.json()) as { jobid?: string; jobId?: string; id?: string };
  const id = created.jobid ?? created.jobId ?? created.id;
  if (!id) throw new Error("midjourney useapi returned no job id");

  const url = await pollUntil(
    async () => {
      const poll = await fetch(`${baseUrl}/midjourney/jobs/${id}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!poll.ok) throw new Error(`midjourney useapi poll failed: ${await readHttpError(poll)}`);
      const job = (await poll.json()) as {
        status?: string;
        error?: string;
        attachments?: Array<{ url?: string }>;
        url?: string;
      };
      if (job.status === "failed") throw new Error(`midjourney useapi failed: ${job.error ?? "unknown"}`);
      const file = job.url ?? job.attachments?.[0]?.url;
      if ((job.status === "completed" || job.status === "done") && file) {
        return { done: true, value: file, status: job.status };
      }
      return { done: false, status: job.status };
    },
    { label: "midjourney useapi", intervalMs: 4000 },
  );
  return download(url);
}

function buildPrompt(input: ImageGenInput, options: MidjourneyOptions): string {
  const version = options.version ? ` --v ${options.version}` : "";
  return `${input.prompt}${version}`.trim();
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`midjourney download failed: ${await readHttpError(res)}`);
  return Buffer.from(await res.arrayBuffer());
}
