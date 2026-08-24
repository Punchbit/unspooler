import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { frameDistance } from "../image.js";
import type { LoopWindow } from "../types.js";

export interface ExtractOptions {
  fps: number;
  /** Keep frames whose distance to the previous kept frame exceeds this (MSE). */
  dedupeThreshold?: number;
  loop?: boolean;
}

export async function extractFrames(video: Buffer, options: ExtractOptions): Promise<Buffer[]> {
  const ffmpeg = (await import("fluent-ffmpeg")).default;
  const ffmpegPath = (await import("ffmpeg-static")).default;
  if (!ffmpegPath) throw new Error("ffmpeg-static did not provide a binary path");
  ffmpeg.setFfmpegPath(ffmpegPath);

  const work = join(tmpdir(), `unspooler-frames-${randomBytes(6).toString("hex")}`);
  await mkdir(work, { recursive: true });
  const input = join(work, "clip.mp4");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(input, video);

  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(input)
        .outputOptions(["-vf", `fps=${options.fps}`])
        .output(join(work, "frame-%04d.png"))
        .on("end", () => resolve())
        .on("error", reject)
        .run();
    });

    const files = (await readdir(work))
      .filter((f) => f.endsWith(".png"))
      .sort();
    const frames = await Promise.all(files.map((f) => readFile(join(work, f))));
    const deduped = await dedupeFrames(frames, options.dedupeThreshold ?? 2.5);
    return deduped;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export async function dedupeFrames(frames: Buffer[], threshold: number): Promise<Buffer[]> {
  if (frames.length <= 1) return frames;
  const kept: Buffer[] = [frames[0]!];
  for (let i = 1; i < frames.length; i++) {
    const dist = await frameDistance(kept[kept.length - 1]!, frames[i]!);
    if (dist >= threshold) kept.push(frames[i]!);
  }
  return kept;
}

/**
 * Find the [in, out] window (inclusive) whose first and last frames are most alike,
 * so walk / idle cycles loop. Prefers windows of at least `minFrames`.
 */
export async function detectLoopWindow(
  frames: Buffer[],
  minFrames = 6,
): Promise<LoopWindow> {
  if (frames.length <= minFrames) {
    return { in: 0, out: Math.max(0, frames.length - 1) };
  }
  let best = { in: 0, out: frames.length - 1, score: Infinity };
  const maxStart = frames.length - minFrames;
  for (let start = 0; start <= maxStart; start++) {
    for (let end = start + minFrames - 1; end < frames.length; end++) {
      const score = await frameDistance(frames[start]!, frames[end]!);
      const lengthBias = (end - start) / frames.length;
      const combined = score - lengthBias * 0.15;
      if (combined < best.score) best = { in: start, out: end, score: combined };
    }
  }
  return { in: best.in, out: best.out };
}

export function applyLoopWindow(frames: Buffer[], window: LoopWindow): Buffer[] {
  const start = Math.max(0, window.in);
  const end = Math.min(frames.length - 1, window.out);
  if (end <= start) return frames;
  return frames.slice(start, end + 1);
}
