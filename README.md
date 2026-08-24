# Unspooler

Turn a prompt (and optional reference images) into game-ready 2D sprite sheets.

Unspooler is a local-first npm package for people vibe-coding games. It does not ask an image model to invent a 4×3 grid in one shot. It generates a reference, animates that reference as video, pulls frames, mattes them, locks a shared foot baseline, and writes a sheet plus a JSON manifest any engine can load.

```
reference → video per animation → frames → AI matte → normalize → sheet + manifest
```

Static props, VFX, and tilesets share the same config and skip the stages they do not need.

## Install

```bash
npm install unspooler
```

Node 20+. You will also want API keys for the models you choose. fal.ai is the default for image and video. Replicate is the default for matting. Neither is required — any object that implements the provider interfaces works, and chroma-key matting runs offline.

```bash
export FAL_KEY=...
export REPLICATE_API_TOKEN=...
```

## Quick start

```bash
npx unspooler init
# press Enter to keep each default, or type a value
npx unspooler build --dry-run
npx unspooler build
npx unspooler studio
```

`init` asks about style, providers, matting, exports, and the first asset. The value in `[brackets]` is the default — press Enter to accept it. `unspooler init --yes` writes those defaults with no prompts (useful in CI).

`--dry-run` prints every stage, cache hits, and an estimated USD total. It makes no API calls. Builds over `$1` (configurable) ask before spending unless you pass `--yes`.

## Config

```ts
import { defineConfig, fal, replicate, chromaKey } from "unspooler";

export default defineConfig({
  style: {
    prompt: "16-bit SNES JRPG pixel art, crisp clean pixels",
    palette: ["#1b1b1e", "#f4efe4", "#c45c26"],
    cellSize: 256,
    pixelNative: 32, // enables pixel-snap
  },
  preset: "preferred", // or "draft" for cheaper/faster models
  models: {
    reference: fal("openai/gpt-image-2"),
    video: fal("fal-ai/kling-video/v3/pro/image-to-video"),
    matte: replicate("sprited/birefnet", { variant: "toonout" }),
    // matte: chromaKey(), // offline fallback
  },
  fps: 12,
  export: { targets: ["generic", "phaser", "css"], outDir: "assets" },
  assets: [
    {
      id: "hero",
      type: "character",
      prompt: "a cloaked adventurer",
      animations: ["idle", "walk", "attack"],
      directions: 4, // generate down/left/up, flip left → right
    },
    { id: "potion", type: "static", prompt: "a red health potion" },
    { id: "boom", type: "vfx", prompt: "a small explosion burst" },
    { id: "grass", type: "tileset", prompt: "seamless grass", tileSize: 32 },
  ],
});
```

### Asset types

| Type | Path |
| --- | --- |
| `character` | reference → video per animation × facing → frames → matte → foot-anchored normalize → pack |
| `static` | reference → matte → trim → pack |
| `vfx` | video path, centroid-anchored, no facings |
| `tileset` | static path + seam check + optional grid slice |

### CLI

| Command | What it does |
| --- | --- |
| `unspooler init [--yes]` | Interactive setup (Enter keeps defaults) |
| `unspooler build [--dry-run] [--yes] [-a id]` | Run the pipeline |
| `unspooler generate <asset> [--takes n]` | Re-roll the reference |
| `unspooler animate <asset> <anim>` | Re-roll one video |
| `unspooler export <target>` | `generic` `phaser` `godot` `css` |
| `unspooler studio` | Local UI: takes, frame scrub, WASD rig |

## Preferred models

These ship as defaults. They are not hard-wired.

| Stage | Preferred | Why |
| --- | --- | --- |
| Reference | fal `openai/gpt-image-2` | Follows style + reference images; clean full-body stills |
| Reference (draft) | fal `fal-ai/flux/schnell` | Fast silhouette / palette iteration |
| Video | fal `fal-ai/kling-video/v3/pro/image-to-video` | Best in-place motion from a still |
| Video (pixel art) | fal Wan 2.2 I2V | Holds a grid/style better than cinematic models |
| Matte | Replicate `sprited/birefnet` `toonout` | MIT, commercial-OK, keeps stylized edges |
| Matte fallback | built-in `chromaKey()` | Offline. Used as a prior on top of AI mattes too |

Video generations are prompted onto chroma green `#00b140` (magenta if the palette is already green). The AI matte is the cut. Chroma is a prior and a fallback so leftover backdrop does not survive as a halo.

Also shipped (same interfaces, pick in `init` or in config):

| Adapter | Env | Default models |
| --- | --- | --- |
| `openai()` | `OPENAI_API_KEY` | `gpt-image-2` (default), `sora-2` |
| `gemini()` / `nanoBanana()` | `GEMINI_API_KEY` | Gemini 3.1 Flash Image (Nano Banana), Veo 3.1 |
| `midjourney()` | `MIDJOURNEY_API_KEY` | Image only, via ImagineAPI or useapi.net — Midjourney has no official API |
| `replicate()` | `REPLICATE_API_TOKEN` | Any Replicate image/video/matte model |
| `httpImage` / `httpVideo` | yours | Any HTTP endpoint |

```ts
import { defineConfig, openai, nanoBanana, midjourney, fal, chromaKey } from "unspooler";

export default defineConfig({
  style: { prompt: "chunky pixel hero, SNES" },
  models: {
    reference: openai("gpt-image-2"), // or nanoBanana(), midjourney(), fal("openai/gpt-image-2")
    video: openai("sora-2"),          // or fal("fal-ai/kling-video/v3/pro/image-to-video")
    matte: chromaKey(),
  },
  assets: [{ id: "hero", type: "character", prompt: "a cloaked adventurer" }],
});
```

`openai("gpt-image-2", { quality: "low" })` is the cheap draft path — about $0.006 vs ~$0.05 medium and ~$0.21 high. Dry-run uses that tier. `init` with the draft preset writes `quality: "low"` automatically.

`midjourney()` talks to a gateway (`backend: "imagineapi"` by default, or `"useapi"`). Set `MIDJOURNEY_BASE_URL` if yours is self-hosted.

## Bring your own models

Every AI stage is an interface. Pass any object, an `httpImage` / `httpVideo` / `httpMatte` endpoint, or a community `unspooler-provider-*` package.

```ts
import type { ImageGenerator } from "unspooler";

const localComfy: ImageGenerator = {
  kind: "image",
  id: "comfy:local",
  estimate: () => ({ usd: 0, unit: "image" }),
  async generate({ prompt }) {
    const res = await fetch("http://127.0.0.1:8188/your-wrapper", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    });
    const { url } = await res.json();
    return { images: [Buffer.from(await (await fetch(url)).arrayBuffer())], model: "comfy" };
  },
};
```

Override per project, per asset, or per animation (`animations: [{ name: "walk", video: fal("fal-ai/wan/...") }]`).

## Output

Each asset writes:

- `assets/<id>.png` — packed sheet
- `assets/<id>.json` — Aseprite / TexturePacker-shaped manifest (frame rects, anchors, fps, loop tags)

Optional exporters:

- **phaser** — atlas JSON + `this.load.atlas` / `anims.create` snippet
- **godot** — `SpriteFrames` `.tres`
- **css** — dependency-free sheet player for web games

## Studio + controller

`unspooler studio` is the human-in-the-loop surface: pick a reference take, scrub frames, and drive the character with WASD. The headless controller lives at `unspooler/controller` and is meant to be extracted into its own package once the binding (states, facings, anchors) has been used on real sheets.

## Cache

Intermediates land in `.unspooler/` keyed by a content hash of prompt + model + options. Re-runs skip paid work. Add `.unspooler/` to gitignore.

## License

AGPL-3.0-only. See [LICENSE](./LICENSE).
