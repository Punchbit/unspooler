import { ANIMATION_PROMPTS, DIRECTION_PROMPTS } from "./defaults.js";
import { chromaPrompt, resolveChromaMode } from "./chroma.js";
import type { ChromaMode, HexColor, StyleConfig } from "./types.js";

export function paletteLine(palette?: HexColor[]): string {
  if (!palette?.length) return "";
  return `Restricted color palette: ${palette.join(", ")}. Stay inside these colors.`;
}

export function buildReferencePrompt(opts: {
  style: StyleConfig;
  prompt: string;
  chroma: ChromaMode;
  kind: "character" | "static" | "vfx" | "tileset";
}): string {
  const mode = resolveChromaMode(opts.chroma, opts.style.palette);
  const extra =
    opts.kind === "tileset"
      ? "Seamless tileable texture, edges wrap cleanly, no character, no text, no border."
      : opts.kind === "vfx"
        ? "A single visual-effect burst centered in frame, no character, no text."
        : opts.kind === "static"
          ? "A single prop or object, centered, full object visible, no text."
          : "Full body in frame, standing idle, feet planted, centered, no crop, no text, no watermark.";

  return [
    opts.style.prompt,
    paletteLine(opts.style.palette),
    opts.prompt,
    extra,
    `Backdrop: ${chromaPrompt(mode)}.`,
    "Even lighting, no drop shadow on the background, no floor plane.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildMotionPrompt(opts: {
  style: StyleConfig;
  assetPrompt: string;
  animation: string;
  animationPrompt?: string;
  direction?: string;
  chroma: ChromaMode;
}): string {
  const mode = resolveChromaMode(opts.chroma, opts.style.palette);
  const facing = opts.direction ? DIRECTION_PROMPTS[opts.direction] ?? "" : "";
  const motion =
    opts.animationPrompt ?? ANIMATION_PROMPTS[opts.animation] ?? `${opts.animation} cycle, looping`;

  return [
    "Locked static camera, no camera movement, no zoom, no pan, no tilt, no cutaways.",
    "The exact character from the reference image performs the action.",
    "Keep identity, outfit, colors, and proportions identical to the reference in every frame.",
    facing,
    motion,
    "Full body stays inside the frame. Character stays in place — animate in situ, do not travel across the screen.",
    `Backdrop: ${chromaPrompt(mode)}.`,
    opts.style.prompt,
    paletteLine(opts.style.palette),
    opts.assetPrompt,
  ]
    .filter(Boolean)
    .join(" ");
}
