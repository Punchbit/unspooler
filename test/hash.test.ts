import { describe, expect, it } from "vitest";
import { hashInputs, stableStringify } from "../src/hash.js";

describe("hash", () => {
  it("is stable across key order", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(hashInputs({ stage: "video", z: 1, a: 2 })).toBe(hashInputs({ a: 2, z: 1, stage: "video" }));
  });
});
