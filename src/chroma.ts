import type { ChromaMode, HexColor } from "./types.js";

export const CHROMA_GREEN_HEX = "#00b140";
export const CHROMA_MAGENTA_HEX = "#ff00ff";

export const CHROMA_GREEN_PROMPT =
  "solid flat uniform chroma-key green (#00b140) background, no shadows on the backdrop, no floor, no gradient";
export const CHROMA_MAGENTA_PROMPT =
  "solid flat uniform chroma-key magenta (#ff00ff) background, no shadows on the backdrop, no floor, no gradient";

export function chromaPrompt(mode: Exclude<ChromaMode, "auto">): string {
  return mode === "magenta" ? CHROMA_MAGENTA_PROMPT : CHROMA_GREEN_PROMPT;
}

export function parseHex(hex: string): { r: number; g: number; b: number } {
  const raw = hex.replace("#", "").trim();
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  const n = Number.parseInt(full.slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function isGreenish({ r, g, b }: { r: number; g: number; b: number }): boolean {
  return g > 85 && g > r * 1.22 && g > b * 1.22;
}

export function isMagentaish({ r, g, b }: { r: number; g: number; b: number }): boolean {
  return r > 140 && b > 140 && g < r * 0.65 && g < b * 0.65;
}

/** Pick magenta when the subject's palette is already green so chroma doesn't eat it. */
export function resolveChromaMode(
  mode: ChromaMode | undefined,
  palette: HexColor[] = [],
): Exclude<ChromaMode, "auto"> {
  if (mode === "green" || mode === "magenta") return mode;
  const greens = palette.filter((hex) => {
    try {
      return isGreenish(parseHex(hex));
    } catch {
      return false;
    }
  });
  return greens.length >= Math.max(1, Math.ceil(palette.length * 0.25)) ? "magenta" : "green";
}

export function isChromaPixel(
  r: number,
  g: number,
  b: number,
  mode: Exclude<ChromaMode, "auto">,
): boolean {
  return mode === "magenta" ? isMagentaish({ r, g, b }) : isGreenish({ r, g, b });
}

/** In-place chroma key on an RGBA buffer. */
export function keyChromaRaw(
  data: Uint8Array | Buffer,
  mode: Exclude<ChromaMode, "auto"> = "green",
): void {
  for (let i = 0; i < data.length; i += 4) {
    if (isChromaPixel(data[i]!, data[i + 1]!, data[i + 2]!, mode)) {
      data[i + 3] = 0;
    }
  }
}

/**
 * Pull leftover key-color fringe off semi-transparent edge pixels.
 * Chroma keying alone always leaves a halo; this desaturates the cast.
 */
export function defringeRaw(
  data: Uint8Array | Buffer,
  width: number,
  height: number,
  mode: Exclude<ChromaMode, "auto">,
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3]!;
      if (a === 0 || a === 255) continue;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      if (mode === "green" && g > r && g > b) {
        const bleed = Math.min(g - r, g - b);
        data[i + 1] = Math.max(0, g - bleed);
        data[i + 3] = Math.max(0, a - Math.round(bleed * 0.35));
      } else if (mode === "magenta" && r > g && b > g) {
        const bleed = Math.min(r, b) - g;
        data[i] = Math.max(0, r - bleed);
        data[i + 2] = Math.max(0, b - bleed);
        data[i + 3] = Math.max(0, a - Math.round(bleed * 0.35));
      }
    }
  }
}

/** Remove isolated transparent specks inside the subject and isolated opaque specks in the void. */
export function despeckleRaw(
  data: Uint8Array | Buffer,
  width: number,
  height: number,
  alphaMin = 32,
): void {
  const copy = Uint8Array.from(data);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      const opaque = copy[i + 3]! > alphaMin;
      let same = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const n = ((y + dy) * width + (x + dx)) * 4;
          if (copy[n + 3]! > alphaMin === opaque) same++;
        }
      }
      if (same <= 1) {
        data[i + 3] = opaque ? 0 : 255;
      }
    }
  }
}
