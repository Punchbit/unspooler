import {
  directionsToGenerate,
  exportTargets,
  resolveAnimations,
  resolveDirections,
} from "./config.js";
import { resolveModels } from "./providers/index.js";
import type {
  AssetConfig,
  BuildPlan,
  PlanStep,
  UnspoolerConfig,
} from "./types.js";
import type { Cache } from "./cache.js";
import { hashInputs } from "./hash.js";


export function cacheKeyFor(parts: Record<string, unknown>): string {
  return hashInputs(parts);
}

export function planAsset(config: UnspoolerConfig, asset: AssetConfig): PlanStep[] {
  const models = resolveModels(config, asset);
  const steps: PlanStep[] = [];

  if (asset.type === "equipment") {
    const facings = asset.directions === 1 ? ["down"] : ["down", "side", "up"];
    for (const facing of facings) {
      const key = cacheKeyFor({
        stage: "equipment",
        asset: asset.id,
        facing,
        prompt: asset.prompt,
        style: config.style,
        provider: models.reference.id,
      });
      steps.push({
        assetId: asset.id,
        type: asset.type,
        stage: "parts",
        cacheHit: false,
        cacheKey: key,
        costUsd: models.reference.estimate?.({ prompt: asset.prompt, takes: 1 }).usd ?? 0,
        providerId: models.reference.id,
        label: `${asset.id} equipment art/${facing} (${models.reference.id})`,
      });
      steps.push(
        localOrPaid(
          asset,
          "segment",
          cacheKeyFor({ stage: "equip-matte", asset: asset.id, facing }),
          models.matte.id,
          models.matte.estimate?.({ frames: [Buffer.alloc(0)] }).usd ?? 0,
          `${asset.id} equipment matte/${facing} (${models.matte.id})`,
        ),
      );
    }
    steps.push(local(asset, "fit", cacheKeyFor({ stage: "equip-fit", asset: asset.id }), `${asset.id} equipment fit + atlas`));
    return steps;
  }

  const refKey = cacheKeyFor({
    stage: "reference",
    asset: asset.id,
    prompt: asset.prompt,
    style: config.style,
    provider: models.reference.id,
  });
  const refHit = false;
  steps.push({
    assetId: asset.id,
    type: asset.type,
    stage: "reference",
    cacheHit: refHit,
    cacheKey: refKey,
    costUsd: refHit ? 0 : models.reference.estimate?.({ prompt: asset.prompt, takes: 1 }).usd ?? 0,
    providerId: models.reference.id,
    label: `${asset.id} reference (${models.reference.id})`,
  });

  if (asset.type === "character") {
    // Skeletal pipeline: parts sheets per facing, then everything local.
    const facings = (asset.directions ?? 4) === 1 ? ["down"] : ["down", "side", "up"];
    for (const facing of facings) {
      const partsKey = cacheKeyFor({
        stage: "parts",
        asset: asset.id,
        facing,
        prompt: asset.prompt,
        style: config.style,
        skeleton: "unspooler-humanoid@1",
        provider: models.reference.id,
      });
      steps.push({
        assetId: asset.id,
        type: asset.type,
        stage: "parts",
        cacheHit: false,
        cacheKey: partsKey,
        costUsd: models.reference.estimate?.({ prompt: asset.prompt, takes: 1 }).usd ?? 0,
        providerId: models.reference.id,
        label: `${asset.id} parts sheet/${facing} (${models.reference.id})`,
      });
      steps.push(
        localOrPaid(
          asset,
          "segment",
          cacheKeyFor({ stage: "segment", asset: asset.id, facing }),
          models.matte.id,
          models.matte.estimate?.({ frames: [Buffer.alloc(0)] }).usd ?? 0,
          `${asset.id} segment/${facing} (${models.matte.id})`,
        ),
      );
    }
    steps.push(local(asset, "fit", cacheKeyFor({ stage: "fit", asset: asset.id }), `${asset.id} skeleton fit + rig atlas`));
    const animCount = resolveAnimations(config, asset).length;
    steps.push(
      local(
        asset,
        "bake",
        cacheKeyFor({ stage: "bake", asset: asset.id }),
        `${asset.id} bake ${animCount} animation(s) × ${resolveDirections(asset).length} direction(s)`,
      ),
    );
    steps.push(local(asset, "pack", cacheKeyFor({ stage: "pack", asset: asset.id }), `${asset.id} pack`));
  } else if (asset.type === "static" || asset.type === "tileset") {
    const matteKey = cacheKeyFor({ stage: "matte", asset: asset.id, ref: refKey, provider: models.matte.id });
    steps.push(localOrPaid(asset, "matte", matteKey, models.matte.id, models.matte.estimate?.({ frames: [Buffer.alloc(0)] }).usd ?? 0, `${asset.id} matte`));
    if (asset.type === "tileset") {
      steps.push(local(asset, "tileset", cacheKeyFor({ stage: "tileset", asset: asset.id }), `${asset.id} tileset slice + seam check`));
    }
    steps.push(local(asset, "normalize", cacheKeyFor({ stage: "normalize", asset: asset.id }), `${asset.id} normalize`));
    steps.push(local(asset, "pack", cacheKeyFor({ stage: "pack", asset: asset.id }), `${asset.id} pack`));
  } else {
    const anims = resolveAnimations(config, asset);
    const dirs = directionsToGenerate(asset);
    const allDirs = resolveDirections(asset);
    for (const anim of anims) {
      const videoGen = anim.video ?? models.video;
      for (const dir of dirs) {
        const videoKey = cacheKeyFor({
          stage: "video",
          asset: asset.id,
          anim: anim.name,
          dir,
          provider: videoGen.id,
          ref: refKey,
        });
        steps.push({
          assetId: asset.id,
          type: asset.type,
          animation: anim.name,
          direction: dir,
          stage: "video",
          cacheHit: false,
          cacheKey: videoKey,
          costUsd: videoGen.estimate?.({ prompt: anim.prompt, image: Buffer.alloc(0) }).usd ?? 0,
          providerId: videoGen.id,
          label: `${asset.id} ${anim.name}/${dir} video (${videoGen.id})`,
        });
        steps.push(local(asset, "frames", cacheKeyFor({ stage: "frames", video: videoKey }), `${asset.id} ${anim.name}/${dir} frames`, anim.name, dir));
        const frameCount = Math.max(4, Math.round(anim.fps * anim.duration));
        const matteCost = models.matte.estimate?.({ frames: Array.from({ length: frameCount }, () => Buffer.alloc(0)) }).usd ?? 0;
        steps.push({
          assetId: asset.id,
          type: asset.type,
          animation: anim.name,
          direction: dir,
          stage: "matte",
          cacheHit: false,
          cacheKey: cacheKeyFor({ stage: "matte", video: videoKey, provider: models.matte.id }),
          costUsd: matteCost,
          providerId: models.matte.id,
          label: `${asset.id} ${anim.name}/${dir} matte (${models.matte.id})`,
        });
        steps.push(local(asset, "normalize", cacheKeyFor({ stage: "normalize", video: videoKey }), `${asset.id} ${anim.name}/${dir} normalize`, anim.name, dir));
      }
      for (const dir of allDirs) {
        if (dirs.includes(dir)) continue;
        steps.push(local(asset, "normalize", cacheKeyFor({ stage: "mirror", anim: anim.name, dir }), `${asset.id} ${anim.name}/${dir} mirror`, anim.name, dir));
      }
    }
    steps.push(local(asset, "pack", cacheKeyFor({ stage: "pack", asset: asset.id }), `${asset.id} pack`));
  }

  for (const target of exportTargets(config)) {
    steps.push({
      assetId: asset.id,
      type: asset.type,
      stage: "export",
      cacheHit: false,
      cacheKey: cacheKeyFor({ stage: "export", asset: asset.id, target }),
      costUsd: 0,
      providerId: target,
      label: `${asset.id} export:${target}`,
    });
  }
  return steps;
}

function local(
  asset: AssetConfig,
  stage: PlanStep["stage"],
  cacheKey: string,
  label: string,
  animation?: string,
  direction?: PlanStep["direction"],
): PlanStep {
  return {
    assetId: asset.id,
    type: asset.type,
    animation,
    direction,
    stage,
    cacheHit: false,
    cacheKey,
    costUsd: 0,
    providerId: "local",
    label,
  };
}

function localOrPaid(
  asset: AssetConfig,
  stage: PlanStep["stage"],
  cacheKey: string,
  providerId: string,
  costUsd: number,
  label: string,
): PlanStep {
  return { ...local(asset, stage, cacheKey, label), providerId, costUsd };
}

export async function markCacheHits(steps: PlanStep[], cache: Cache): Promise<PlanStep[]> {
  return Promise.all(
    steps.map(async (step) => {
      if (step.costUsd <= 0) return step;
      const hit = await cache.has(step.cacheKey);
      return hit ? { ...step, cacheHit: true, costUsd: 0 } : step;
    }),
  );
}

export function summarizePlan(steps: PlanStep[]): BuildPlan {
  return {
    steps,
    cacheHits: steps.filter((s) => s.cacheHit).length,
    paidCalls: steps.filter((s) => s.costUsd > 0).length,
    estimatedUsd: roundUsd(steps.reduce((sum, s) => sum + s.costUsd, 0)),
  };
}

export function formatPlan(plan: BuildPlan): string {
  const lines = ["Unspooler build plan", "--------------------"];
  for (const step of plan.steps) {
    const flag = step.cacheHit ? "cache" : step.costUsd > 0 ? `$${step.costUsd.toFixed(3)}` : "local";
    lines.push(`  [${flag.padStart(7)}] ${step.label}`);
  }
  lines.push("--------------------");
  lines.push(
    `${plan.paidCalls} paid call(s), ${plan.cacheHits} cache hit(s), estimated $${plan.estimatedUsd.toFixed(2)}`,
  );
  return lines.join("\n");
}

function roundUsd(n: number): number {
  return Math.round(n * 1000) / 1000;
}
