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
  kind: "character" | "static" | "vfx" | "tileset" | "equipment";
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

const FACING_VIEW: Record<string, string> = {
  down: "front view, facing the camera",
  side: "side profile view, facing left",
  up: "back view, facing away from the camera",
};

/**
 * Prompt for the body-parts sheet: the exact character from the reference,
 * disassembled into separated parts laid out on a strict grid so the
 * segmenter can slice cells deterministically.
 */
export function buildPartsSheetPrompt(opts: {
  style: StyleConfig;
  prompt: string;
  facing: "down" | "side" | "up";
  chroma: ChromaMode;
  layout: { cols: number; rows: number; order: string[] };
}): string {
  const mode = resolveChromaMode(opts.chroma, opts.style.palette);
  const rows: string[] = [];
  for (let r = 0; r < opts.layout.rows; r++) {
    const cells = opts.layout.order.slice(r * opts.layout.cols, (r + 1) * opts.layout.cols);
    if (cells.length) rows.push(`row ${r + 1}: ${cells.map(humanPartName).join(", ")}`);
  }
  return [
    "A character body-parts sheet for a cutout animation rig.",
    "The exact character from the reference image, disassembled into separate body parts.",
    `Every part drawn in ${FACING_VIEW[opts.facing]}, in a relaxed neutral pose, at the same consistent scale.`,
    `Lay the parts out on a strict ${opts.layout.cols} column by ${opts.layout.rows} row grid, one part per grid cell, in this exact order — ${rows.join("; ")}.`,
    "Generous empty spacing between parts, no part touches or overlaps another, no labels, no text, no outlines around cells.",
    "Keep identity, outfit, colors, and proportions identical to the reference.",
    "Draw each limb complete, including areas normally hidden by other body parts (paint the full shoulder, hip, and neck stumps).",
    `Backdrop: ${chromaPrompt(mode)}.`,
    "Even lighting, no drop shadows.",
    opts.style.prompt,
    paletteLine(opts.style.palette),
    opts.prompt,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Prompt for one facing of an equipment item: the item alone, matched to the
 * project style, ready to attach to a bone.
 */
export function buildEquipmentPrompt(opts: {
  style: StyleConfig;
  prompt: string;
  facing: "down" | "side" | "up";
  chroma: ChromaMode;
}): string {
  const mode = resolveChromaMode(opts.chroma, opts.style.palette);
  return [
    opts.style.prompt,
    paletteLine(opts.style.palette),
    opts.prompt,
    `A single item drawn alone, ${FACING_VIEW[opts.facing]}, centered, complete and fully visible.`,
    "No character, no hands, no body, no text, no labels.",
    `Backdrop: ${chromaPrompt(mode)}.`,
    "Even lighting, no drop shadow.",
  ]
    .filter(Boolean)
    .join(" ");
}

function humanPartName(part: string): string {
  return part
    .replace(".L", " (character's screen-left)")
    .replace(".R", " (character's screen-right)")
    .replace("arm", "full arm without hand")
    .replace("hand", "hand")
    .replace("leg", "full leg without foot")
    .replace("torso", "torso without head, arms, or legs")
    .replace("head", "head with neck");
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
