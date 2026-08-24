import type { SpriteManifest } from "./types.js";

export function manifestToJson(manifest: SpriteManifest): string {
  return JSON.stringify(manifest, null, 2);
}

export function parseManifest(raw: string | unknown): SpriteManifest {
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  return data as SpriteManifest;
}

export function framesFor(
  manifest: SpriteManifest,
  animation: string,
  direction?: string,
): SpriteManifest["frames"] {
  const tagName = direction ? `${animation}-${direction}` : animation;
  const tag = manifest.meta.frameTags.find((t) => t.name === tagName)
    ?? manifest.meta.frameTags.find((t) => t.name === animation);
  if (!tag) {
    return manifest.frames.filter(
      (f) => f.animation === animation && (!direction || f.direction === direction),
    );
  }
  return manifest.frames.slice(tag.from, tag.to + 1);
}
