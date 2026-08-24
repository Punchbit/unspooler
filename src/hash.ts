import { createHash } from "node:crypto";

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function shortHash(data: string | Buffer, length = 12): string {
  return sha256(data).slice(0, length);
}

/** Stable JSON stringify with sorted keys so cache keys don't shuffle. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const v = obj[key];
      if (v === undefined) continue;
      out[key] = sortValue(v);
    }
    return out;
  }
  return value;
}

export function hashInputs(parts: Record<string, unknown>): string {
  return sha256(stableStringify(parts));
}
