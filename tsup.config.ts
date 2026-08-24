import { defineConfig } from "tsup";

const external = [
  "@fal-ai/client",
  "replicate",
  "sharp",
  "fluent-ffmpeg",
  "ffmpeg-static",
  "jiti",
  "hono",
  "@hono/node-server",
  "commander",
  "zod",
];

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      "controller/index": "src/controller/index.ts",
    },
    format: ["esm"],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    target: "node20",
    external,
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    dts: false,
    splitting: false,
    sourcemap: true,
    clean: false,
    target: "node20",
    external,
  },
]);
