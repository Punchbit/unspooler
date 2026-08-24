import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Cache, StateStore } from "../cache.js";
import {
  cellSize,
  costThreshold,
  directionsToGenerate,
  exportTargets,
  resolveAnimations,
  resolveDirections,
  resolveFacings,
  resolveFps,
  resolveOutDir,
  resolveWorkDir,
} from "../config.js";
import { formatPlan, markCacheHits, planAsset, summarizePlan } from "../cost.js";
import { getExporter } from "../exporters/index.js";
import { flipHorizontal } from "../image.js";
import { resolveChromaMode } from "../chroma.js";
import { resolveModels } from "../providers/index.js";
import type {
  AssetConfig,
  BuildArtifact,
  BuildResult,
  Direction,
  PlanStep,
  UnspoolerConfig,
  UnspoolOptions,
} from "../types.js";
import { applyLoopWindow, detectLoopWindow, extractFrames } from "./frames.js";
import { matteFrames } from "./matte.js";
import { anchorModeFor, normalizeFrames, type NormalizedFrame } from "./normalize.js";
import { packSheet, type PackedClip } from "./pack.js";
import { generateReference } from "./reference.js";
import { measureSeams, sliceTiles } from "./tileset.js";
import { generateVideo } from "./video.js";
import { generatePartsSheet } from "./parts.js";
import { segmentParts, type SegmentedParts } from "./segment.js";
import { fitToSkeleton } from "./fit.js";
import { bakeClips } from "./bake.js";
import { generateEquipmentArt, fitEquipment } from "./equipment.js";
import { exportCssRig, exportGodotRig, exportRigGeneric } from "../exporters/rig.js";
import { HUMANOID, facingsFor } from "../rig/skeleton.js";
import type { Facing } from "../rig/types.js";

/** Character height in atlas pixels that standalone equipment is fit against. */
export const DEFAULT_RIG_PIXEL_HEIGHT = 512;

export async function unspool(
  config: UnspoolerConfig,
  options: UnspoolOptions = {},
): Promise<BuildResult> {
  const cwd = options.cwd ?? process.cwd();
  const workDir = resolveWorkDir(config, cwd);
  const outDir = resolveOutDir(config, cwd);
  const cache = new Cache(workDir);
  const state = new StateStore(workDir);
  await mkdir(workDir, { recursive: true });

  const assets = options.assetIds
    ? config.assets.filter((a) => options.assetIds!.includes(a.id))
    : config.assets;
  if (!assets.length) throw new Error("No matching assets to build.");

  let steps: PlanStep[] = assets.flatMap((asset) => planAsset(config, asset));
  steps = await markCacheHits(steps, cache);
  const plan = summarizePlan(steps);

  if (options.dryRun) {
    return { plan, artifacts: [], dryRun: true };
  }

  if (!options.yes && plan.estimatedUsd > costThreshold(config)) {
    const ok = options.confirm ? await options.confirm(plan) : false;
    if (!ok) {
      return { plan, artifacts: [], dryRun: true };
    }
  }

  const artifacts: BuildArtifact[] = [];
  for (const asset of assets) {
    options.onStep?.({
      assetId: asset.id,
      type: asset.type,
      stage: "reference",
      cacheHit: false,
      cacheKey: "",
      costUsd: 0,
      providerId: "",
      label: `building ${asset.id}`,
    });
    artifacts.push(await buildAsset(config, asset, { cache, state, outDir, cwd, onStep: options.onStep }));
  }
  return { plan, artifacts, dryRun: false };
}

async function buildAsset(
  config: UnspoolerConfig,
  asset: AssetConfig,
  ctx: {
    cache: Cache;
    state: StateStore;
    outDir: string;
    cwd: string;
    onStep?: (step: PlanStep) => void;
  },
): Promise<BuildArtifact> {
  const models = resolveModels(config, asset);
  const project = await ctx.state.load();
  const selected = project.selected[asset.id] ?? {};
  const chroma = resolveChromaMode(asset.chroma ?? config.chroma ?? "auto", config.style.palette);
  const cell = cellSize(config);
  const fps = resolveFps(config, asset);

  if (asset.type === "equipment") {
    return buildEquipmentAsset(config, asset, { ...ctx, models });
  }

  let reference: Buffer;
  if (selected.reference) {
    const { toBuffer } = await import("../media.js");
    reference = await toBuffer(selected.reference);
  } else {
    const refKey = ctx.cache.key({
      stage: "reference",
      asset: asset.id,
      prompt: asset.prompt,
      style: config.style,
      provider: models.reference.id,
    });
    const cached = await ctx.cache.read(refKey, "reference.png");
    if (cached) {
      reference = cached;
    } else {
      const images = await generateReference({ config, asset, generator: models.reference, takes: 1 });
      reference = images[0]!;
      await ctx.cache.write(refKey, reference, "reference.png");
      await ctx.cache.saveTake(asset.id, "reference", `${Date.now()}.png`, reference);
    }
  }

  if (asset.type === "character") {
    return buildRigAsset(config, asset, reference, {
      ...ctx,
      models,
      selected,
      cell,
      fps,
    });
  }

  const clips: PackedClip[] = [];
  const anchor = anchorModeFor(asset.type);

  if (asset.type === "static" || asset.type === "tileset") {
    let frame = reference;
    const matted = await matteFrames([frame], {
      remover: models.matte,
      chroma,
      palette: config.style.palette,
    });
    frame = matted[0]!;
    if (asset.type === "tileset") {
      const report = await measureSeams(frame);
      if (!report.ok) {
        console.warn(
          `[unspooler] tileset "${asset.id}" seam score ${report.score.toFixed(1)} exceeds ${report.threshold}. Edges will tile poorly.`,
        );
      }
      if (asset.tileGrid) {
        const tiles = await sliceTiles(frame, asset.tileGrid);
        const normalized = await normalizeFrames(tiles, {
          cell: asset.tileSize ? { w: asset.tileSize, h: asset.tileSize } : cell,
          mode: "none",
          pixelNative: config.style.pixelNative,
          palette: config.style.palette,
        });
        clips.push({
          animation: "tiles",
          loop: false,
          fps,
          frames: normalized,
        });
      }
    }
    if (!clips.length) {
      const normalized = await normalizeFrames([frame], {
        cell,
        mode: "none",
        pixelNative: config.style.pixelNative,
        palette: config.style.palette,
      });
      clips.push({ animation: "idle", loop: false, fps, frames: normalized });
    }
  } else {
    const anims = resolveAnimations(config, asset);
    const generateDirs = directionsToGenerate(asset);
    const allDirs = resolveDirections(asset);

    for (const anim of anims) {
      const generated = new Map<Direction, NormalizedFrame[]>();
      const videoGen = anim.video ?? models.video;
      for (const dir of generateDirs) {
        ctx.onStep?.({
          assetId: asset.id,
          type: asset.type,
          animation: anim.name,
          direction: dir,
          stage: "video",
          cacheHit: false,
          cacheKey: "",
          costUsd: 0,
          providerId: videoGen.id,
          label: `${asset.id} ${anim.name}/${dir}`,
        });
        const videoKey = ctx.cache.key({
          stage: "video",
          asset: asset.id,
          anim: anim.name,
          dir,
          provider: videoGen.id,
        });
        let video = await ctx.cache.read(videoKey, "clip.mp4");
        if (!video) {
          video = await generateVideo({
            config,
            asset,
            animation: anim,
            direction: dir,
            image: reference,
            generator: videoGen,
          });
          await ctx.cache.write(videoKey, video, "clip.mp4");
          await ctx.cache.saveTake(asset.id, `${anim.name}-${dir}`, `${Date.now()}.mp4`, video);
        }
        let frames = await extractFrames(video, { fps: anim.fps, loop: anim.loop });
        const override = selected.animations?.[anim.name]?.[dir]?.loop;
        const window = override ?? (anim.loop ? await detectLoopWindow(frames) : { in: 0, out: frames.length - 1 });
        frames = applyLoopWindow(frames, window);
        frames = await matteFrames(frames, {
          remover: models.matte,
          chroma,
          palette: config.style.palette,
          variant: selected.animations?.[anim.name]?.[dir]?.matteVariant,
        });
        const normalized = await normalizeFrames(frames, {
          cell,
          mode: anchor,
          pixelNative: config.style.pixelNative,
          palette: config.style.palette,
        });
        generated.set(dir, normalized);
      }

      for (const dir of allDirs) {
        let frames = generated.get(dir);
        if (!frames && dir.includes("right")) {
          const sourceDir = dir.replace("right", "left") as Direction;
          const source = generated.get(sourceDir);
          if (source) {
            frames = await Promise.all(
              source.map(async (f) => ({
                png: await flipHorizontal(f.png),
                anchor: { x: cell.w - f.anchor.x, y: f.anchor.y },
              })),
            );
          }
        }
        if (!frames) continue;
        clips.push({
          animation: anim.name,
          direction: dir,
          loop: anim.loop,
          fps: anim.fps,
          frames,
        });
      }
    }
  }

  const imageName = `${asset.id}.png`;
  const packed = await packSheet({
    asset,
    clips,
    cell,
    fps,
    anchorMode: anchor,
    imageName,
  });

  await mkdir(ctx.outDir, { recursive: true });
  const sheetPath = join(ctx.outDir, imageName);
  const manifestPath = join(ctx.outDir, `${asset.id}.json`);
  const exports = [];
  for (const target of exportTargets(config)) {
    const exporter = getExporter(target);
    exports.push(
      ...(await exporter.export({
        asset,
        manifest: packed.manifest,
        sheet: packed.sheet,
        sheetFileName: imageName,
        outDir: ctx.outDir,
      })),
    );
  }
  if (!exportTargets(config).includes("generic")) {
    await writeFile(sheetPath, packed.sheet);
    await writeFile(manifestPath, JSON.stringify(packed.manifest, null, 2));
  }

  return {
    assetId: asset.id,
    sheetPath,
    manifestPath,
    exports,
  };
}

/**
 * Skeletal character build: reference → per-facing parts sheets → segment →
 * fit to the standard skeleton → write rig manifest + atlas → bake the
 * animation library into a plain spritesheet locally → existing exporters.
 */
async function buildRigAsset(
  config: UnspoolerConfig,
  asset: AssetConfig,
  reference: Buffer,
  ctx: {
    cache: Cache;
    state: StateStore;
    outDir: string;
    cwd: string;
    onStep?: (step: PlanStep) => void;
    models: ReturnType<typeof resolveModels>;
    selected: { rig?: import("../rig/types.js").RigOverrides };
    cell: { w: number; h: number };
    fps: number;
  },
): Promise<BuildArtifact> {
  const chroma = resolveChromaMode(asset.chroma ?? config.chroma ?? "auto", config.style.palette);
  const facings = facingsFor(asset.directions ?? 4);
  const segmented: Partial<Record<Facing, SegmentedParts>> = {};

  for (const facing of facings) {
    ctx.onStep?.({
      assetId: asset.id,
      type: asset.type,
      stage: "parts",
      cacheHit: false,
      cacheKey: "",
      costUsd: 0,
      providerId: ctx.models.reference.id,
      label: `${asset.id} parts/${facing}`,
    });
    const partsKey = ctx.cache.key({
      stage: "parts",
      asset: asset.id,
      facing,
      prompt: asset.prompt,
      style: config.style,
      skeleton: `${HUMANOID.id}@${HUMANOID.version}`,
      provider: ctx.models.reference.id,
    });
    let sheet = await ctx.cache.read(partsKey, "parts.png");
    if (!sheet) {
      sheet = await generatePartsSheet({
        config,
        asset,
        skeleton: HUMANOID,
        facing,
        reference,
        generator: ctx.models.reference,
      });
      await ctx.cache.write(partsKey, sheet, "parts.png");
      await ctx.cache.saveTake(asset.id, `parts-${facing}`, `${Date.now()}.png`, sheet);
    }
    segmented[facing] = await segmentParts(sheet, {
      skeleton: HUMANOID,
      remover: ctx.models.matte,
      chroma,
      palette: config.style.palette,
    });
  }

  const animations = resolveAnimations(config, asset).map((a) => a.name);
  const atlasName = `${asset.id}.rig.png`;
  const { atlas, manifest: rig } = await fitToSkeleton({
    assetId: asset.id,
    skeleton: HUMANOID,
    facings: segmented,
    fps: ctx.fps,
    animations,
    atlasName,
    overrides: ctx.selected.rig,
  });

  await mkdir(ctx.outDir, { recursive: true });
  const exports = [...(await exportRigGeneric({ assetId: asset.id, rig, atlas, outDir: ctx.outDir }))];

  ctx.onStep?.({
    assetId: asset.id,
    type: asset.type,
    stage: "bake",
    cacheHit: false,
    cacheKey: "",
    costUsd: 0,
    providerId: "local",
    label: `${asset.id} bake spritesheet`,
  });
  const directions = resolveDirections(asset);
  const clips = await bakeClips({
    rig,
    atlas,
    cell: ctx.cell,
    fps: ctx.fps,
    animations,
    directions,
    pixelNative: config.style.pixelNative,
    palette: config.style.palette,
  });

  const imageName = `${asset.id}.png`;
  const packed = await packSheet({
    asset,
    clips,
    cell: ctx.cell,
    fps: ctx.fps,
    anchorMode: "feet",
    imageName,
  });

  const sheetPath = join(ctx.outDir, imageName);
  const manifestPath = join(ctx.outDir, `${asset.id}.json`);
  const targets = exportTargets(config);
  for (const target of targets) {
    const exporter = getExporter(target);
    exports.push(
      ...(await exporter.export({
        asset,
        manifest: packed.manifest,
        sheet: packed.sheet,
        sheetFileName: imageName,
        outDir: ctx.outDir,
      })),
    );
  }
  if (!targets.includes("generic")) {
    await writeFile(sheetPath, packed.sheet);
    await writeFile(manifestPath, JSON.stringify(packed.manifest, null, 2));
  }
  if (targets.includes("godot")) {
    exports.push(...(await exportGodotRig({ assetId: asset.id, rig, atlas, outDir: ctx.outDir })));
  }
  if (targets.includes("css")) {
    exports.push(...(await exportCssRig({ assetId: asset.id, rig, atlas, outDir: ctx.outDir })));
  }

  return {
    assetId: asset.id,
    sheetPath,
    manifestPath,
    exports,
    rigPath: join(ctx.outDir, `${asset.id}.rig.json`),
    rigAtlasPath: join(ctx.outDir, atlasName),
  };
}

/**
 * Equipment build: per-facing item art → matte + trim + scale → item atlas
 * and manifest. Attaching to a character is deterministic and free, so no
 * per-character work happens here.
 */
async function buildEquipmentAsset(
  config: UnspoolerConfig,
  asset: AssetConfig,
  ctx: {
    cache: Cache;
    outDir: string;
    onStep?: (step: PlanStep) => void;
    models: ReturnType<typeof resolveModels>;
  },
): Promise<BuildArtifact> {
  const facings = facingsFor(asset.directions ?? 4);
  const art: Partial<Record<Facing, Buffer>> = {};
  const { toBuffer } = await import("../media.js");
  const references = await Promise.all(
    [...(config.style.references ?? []), ...(asset.references ?? [])].map((p) => toBuffer(p)),
  );

  for (const facing of facings) {
    ctx.onStep?.({
      assetId: asset.id,
      type: asset.type,
      stage: "parts",
      cacheHit: false,
      cacheKey: "",
      costUsd: 0,
      providerId: ctx.models.reference.id,
      label: `${asset.id} equipment/${facing}`,
    });
    const key = ctx.cache.key({
      stage: "equipment",
      asset: asset.id,
      facing,
      prompt: asset.prompt,
      style: config.style,
      provider: ctx.models.reference.id,
    });
    let image = await ctx.cache.read(key, "item.png");
    if (!image) {
      image = await generateEquipmentArt({
        config,
        asset,
        facing,
        generator: ctx.models.reference,
        references: references.length ? references : undefined,
      });
      await ctx.cache.write(key, image, "item.png");
      await ctx.cache.saveTake(asset.id, `equipment-${facing}`, `${Date.now()}.png`, image);
    }
    art[facing] = image;
  }

  const atlasName = `${asset.id}.equip.png`;
  const { atlas, manifest } = await fitEquipment({
    asset,
    facings: art,
    remover: ctx.models.matte,
    atlasName,
    characterPixelHeight: DEFAULT_RIG_PIXEL_HEIGHT,
  });

  await mkdir(ctx.outDir, { recursive: true });
  const atlasPath = join(ctx.outDir, atlasName);
  const manifestPath = join(ctx.outDir, `${asset.id}.equip.json`);
  await writeFile(atlasPath, atlas);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  return {
    assetId: asset.id,
    sheetPath: atlasPath,
    manifestPath,
    exports: [
      { path: atlasPath, contents: atlas },
      { path: manifestPath, contents: JSON.stringify(manifest, null, 2) },
    ],
    rigPath: manifestPath,
    rigAtlasPath: atlasPath,
  };
}

export { formatPlan };
