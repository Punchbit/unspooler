import { describe, expect, it } from "vitest";
import {
  isChromaPixel,
  keyChromaRaw,
  resolveChromaMode,
  parseHex,
} from "../src/chroma.js";

describe("chroma", () => {
  it("picks magenta when the palette is mostly green", () => {
    expect(resolveChromaMode("auto", ["#1a8f3c", "#2db34f", "#f4efe4"])).toBe("magenta");
    expect(resolveChromaMode("auto", ["#c45c26", "#1b1b1e"])).toBe("green");
    expect(resolveChromaMode("green", ["#1a8f3c"])).toBe("green");
  });

  it("keys saturated green and magenta", () => {
    expect(isChromaPixel(0, 177, 64, "green")).toBe(true);
    expect(isChromaPixel(40, 30, 20, "green")).toBe(false);
    expect(isChromaPixel(255, 0, 255, "magenta")).toBe(true);
  });

  it("clears alpha on key pixels", () => {
    const data = Buffer.from([0, 180, 60, 255, 10, 10, 10, 255]);
    keyChromaRaw(data, "green");
    expect(data[3]).toBe(0);
    expect(data[7]).toBe(255);
  });

  it("parses short hex", () => {
    expect(parseHex("#0f8")).toEqual({ r: 0, g: 255, b: 136 });
  });
});
