# Unspooler

Turn a prompt (and optional reference images) into game-ready 2D characters, sheets, and rigs.

Unspooler is a local-first npm package for people vibe-coding games.

**Characters are skeletal.** The AI draws the character's body parts once. Unspooler fits them to a standard humanoid skeleton with a built-in animation library (idle, walk, run, jump, attack, hurt, death), so every character you generate gets every animation immediately — bone data played locally, no per-animation generation cost. Equipment (swords, helmets, boots) attaches to named bones with the right z-order per facing, deterministically. Everything can be baked down to a plain spritesheet at zero AI cost.

```
character:  reference → parts sheets (3 facings) → segment → fit to skeleton
            → rig.json + atlas  →  bake library clips → sheet + manifest
equipment:  item art per facing → matte → item atlas + slot manifest
```

**VFX, statics, and tilesets are video/image-first.** Organic one-off motion is what video models are great at:

```
vfx:     reference → video → frames → AI matte → normalize → sheet + manifest
static:  reference → matte → trim → pack
tileset: static path + seam check + optional grid slice
```

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
      animations: ["idle", "walk", "attack"], // from the built-in library — omit to get all 7
      directions: 4, // parts drawn for down/side/up, side flipped for right
    },
    {
      id: "sword",
      type: "equipment",
      prompt: "a plain iron shortsword",
      slot: "hand.main", // head · body · hand.main · hand.off · feet
      itemScale: 0.55, // item height as a fraction of character height
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
| `character` | reference → parts sheets per facing → segment → fit to skeleton → rig + atlas → local bake → pack |
| `equipment` | item art per facing → matte → item atlas + slot manifest (attaches to any character) |
| `static` | reference → matte → trim → pack |
| `vfx` | reference → video → frames → matte → centroid-anchored normalize → pack |
| `tileset` | static path + seam check + optional grid slice |

### Characters: how the skeletal system works

- **One skeleton, every character.** All characters rig to `unspooler-humanoid@1` (12 bones, 10 parts, 3 facings). That is what makes the animation library and the equipment format universal.
- **Animations are data, not generations.** The core library ships with the package; adding an animation to a character costs nothing. Custom clips are plain keyframe files on the same bones.
- **Equipment is deterministic.** A sword is a sprite following the `hand.R` bone with a grip offset — it points the right way in every frame of every animation by construction. Z-order per facing (behind the body facing up, in front facing down) is a data table on the skeleton, not detection.
- **Bake anywhere.** `unspooler bake hero --equip sword,helmet` renders any character wearing any item set to an ordinary spritesheet, locally, in seconds. All exporters keep working.
- **Fix once, not per frame.** The Studio's parts tab shows each segmented part with its bone pivot; click to correct a pivot, and the next build re-fits and re-bakes. Corrections persist in `state.json`.

### CLI

| Command | What it does |
| --- | --- |
| `unspooler init [--yes]` | Interactive setup (Enter keeps defaults) |
| `unspooler build [--dry-run] [--yes] [-a id]` | Run the pipeline |
| `unspooler bake <character> [--equip a,b]` | Re-bake a sheet locally, optionally wearing equipment — $0 |
| `unspooler generate <asset> [--takes n]` | Re-roll the reference |
| `unspooler animate <asset> <anim>` | Re-roll one vfx video |
| `unspooler export <target>` | `generic` `phaser` `godot` `css` |
| `unspooler studio` | Local UI: takes, frames, parts/pivot inspector, equip panel, WASD rig |

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

- `assets/<id>.png` — packed sheet (characters: baked from the rig)
- `assets/<id>.json` — Aseprite / TexturePacker-shaped manifest (frame rects, anchors, fps, loop tags)

Characters also write:

- `assets/<id>.rig.json` + `assets/<id>.rig.png` — rig manifest and parts atlas, the source of truth for runtimes
- `assets/<id>.rig.tscn` (godot target) — Skeleton2D scene: Bone2D hierarchy, part sprites, AnimationPlayer with the full library
- `assets/<id>.rig.html` (css target) — self-contained bone-runtime player with WASD, no dependencies

Equipment writes `assets/<id>.equip.json` + `assets/<id>.equip.png`.

Optional exporters (fed by the baked sheet, so they work for every asset type):

- **phaser** — atlas JSON + `this.load.atlas` / `anims.create` snippet
- **godot** — `SpriteFrames` `.tres` (plus the Skeleton2D scene for characters)
- **css** — dependency-free sheet player for web games

## Studio + runtime

`unspooler studio` is the human-in-the-loop surface: pick a reference take, inspect segmented parts and correct bone pivots, preview any library clip, toggle equipment live, and drive the character with WASD.

The dependency-free runtime lives at `unspooler/controller`: `CharacterController` (movement/state machine), `RigPlayer` (bone evaluation → back-to-front draw list), the `HUMANOID` skeleton, and the clip library. In a game:

```ts
import { CharacterController, RigPlayer } from "unspooler/controller";

const player = new RigPlayer(rigManifest); // assets/hero.rig.json
const hero = new CharacterController();
hero.attachRig(player);
hero.equip(swordManifest); // assets/sword.equip.json — follows the hand bone

// per frame:
const snap = hero.update(input, dtMs);
for (const cmd of hero.drawList(scale)) {
  /* draw cmd.frame from the atlas at (snap.x + cmd.x, snap.y + cmd.y), rotated cmd.rotation */
}
```

## Cache

Intermediates land in `.unspooler/` keyed by a content hash of prompt + model + options. Re-runs skip paid work. Add `.unspooler/` to gitignore.

## License

AGPL-3.0-only. See [LICENSE](./LICENSE).
