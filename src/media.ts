import { readFile } from "node:fs/promises";

export async function toBuffer(input: Buffer | string): Promise<Buffer> {
  if (Buffer.isBuffer(input)) return input;
  if (input.startsWith("http://") || input.startsWith("https://")) {
    const res = await fetch(input);
    if (!res.ok) throw new Error(`Failed to fetch ${input}: ${res.status} ${res.statusText}`);
    return Buffer.from(await res.arrayBuffer());
  }
  if (input.startsWith("data:")) {
    const comma = input.indexOf(",");
    return Buffer.from(input.slice(comma + 1), "base64");
  }
  return readFile(input);
}

export function toDataUrl(buf: Buffer, mime = "image/png"): string {
  return `data:${mime};base64,${buf.toString("base64")}`;
}

export async function downloadToBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${url}: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

export function guessImageMime(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  if (buf[0] === 0x52 && buf[1] === 0x49) return "image/webp";
  return "image/png";
}

export function guessVideoMime(buf: Buffer): string {
  if (buf[4] === 0x66 && buf[5] === 0x74) return "video/mp4";
  if (buf[0] === 0x1a && buf[1] === 0x45) return "video/webm";
  return "video/mp4";
}
