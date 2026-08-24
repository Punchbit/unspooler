#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Command } from "commander";
import { loadConfig, resolveOutDir } from "./config.js";
import { formatPlan } from "./cost.js";
import { getExporter } from "./exporters/index.js";
import { unspool } from "./pipeline/orchestrate.js";
import { generateReference } from "./pipeline/reference.js";
import { generateVideo } from "./pipeline/video.js";
import { resolveAnimations, resolveDirections } from "./config.js";
import { resolveModels } from "./providers/index.js";
import { Cache } from "./cache.js";
import { resolveWorkDir } from "./config.js";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_INIT,
  INIT_GITIGNORE,
  promptInit,
  renderConfig,
  renderEnv,
} from "./init-template.js";

const program = new Command();
program
  .name("unspooler")
  .description("AI game asset pipeline: skeletal characters with equippable items, plus video-first vfx/statics/tilesets")
  .version("0.1.0");

program
  .command("init")
  .description("Scaffold unspooler.config.ts — asks about providers and exports, Enter keeps defaults")
  .option("-d, --dir <path>", "project directory", ".")
  .option("-y, --yes", "skip prompts and write the defaults", false)
  .action(async (opts: { dir: string; yes?: boolean }) => {
    const dir = resolve(process.cwd(), opts.dir);
    await mkdir(dir, { recursive: true });
    const configPath = resolve(dir, "unspooler.config.ts");
    const skipPrompt = Boolean(opts.yes) || !input.isTTY;

    if (existsSync(configPath) && !opts.yes) {
      const overwrite = skipPrompt ? false : await ask("unspooler.config.ts already exists. Overwrite? [y/N] ");
      if (!overwrite) {
        console.log("Left the existing config alone.");
        return;
      }
    } else if (existsSync(configPath) && opts.yes) {
      console.log("unspooler.config.ts already exists — left it alone (pass without --yes to overwrite).");
      return;
    }

    let answers = DEFAULT_INIT;
    if (!skipPrompt) {
      console.log("");
      console.log("Unspooler setup");
      console.log("Press Enter to accept the value in [brackets].");
      console.log("");
      const rl = createInterface({ input, output });
      try {
        answers = await promptInit((question) => rl.question(question));
      } finally {
        rl.close();
      }
    }

    await writeFile(configPath, renderConfig(answers));
    const envPath = resolve(dir, ".env.example");
    if (!existsSync(envPath)) await writeFile(envPath, renderEnv(answers));
    const gitignore = resolve(dir, ".gitignore");
    if (!existsSync(gitignore) || !(await readFile(gitignore, "utf8")).includes(".unspooler")) {
      await writeFile(gitignore, INIT_GITIGNORE, { flag: "a" });
    }

    const keys = [];
    if (answers.provider === "fal" || answers.videoProvider === "fal") keys.push("FAL_KEY");
    if (answers.provider === "openai" || answers.videoProvider === "openai") keys.push("OPENAI_API_KEY");
    if (answers.provider === "gemini" || answers.videoProvider === "gemini") keys.push("GEMINI_API_KEY");
    if (answers.provider === "midjourney") keys.push("MIDJOURNEY_API_KEY");
    if (answers.provider === "replicate" || answers.videoProvider === "replicate" || answers.matte === "replicate") {
      keys.push("REPLICATE_API_TOKEN");
    }
    console.log(`Wrote ${configPath}`);
    if (keys.length) console.log(`Set ${keys.join(" and ")}, then run \`unspooler build --dry-run\`.`);
    else console.log("Run `unspooler build --dry-run` when you are ready.");
  });

program
  .command("build")
  .description("Run the full pipeline for every asset")
  .option("-c, --config <path>", "config file")
  .option("--dry-run", "print the plan and cost, make no API calls", false)
  .option("-y, --yes", "skip the cost confirmation prompt", false)
  .option("-a, --asset <id>", "only build this asset id", collect, [] as string[])
  .action(async (opts: { config?: string; dryRun?: boolean; yes?: boolean; asset: string[] }) => {
    const cwd = process.cwd();
    const config = await loadConfig(cwd, opts.config);
    const result = await unspool(config, {
      cwd,
      dryRun: Boolean(opts.dryRun),
      yes: Boolean(opts.yes),
      assetIds: opts.asset.length ? opts.asset : undefined,
      confirm: async (plan) => {
        console.log(formatPlan(plan));
        if (opts.yes || plan.estimatedUsd === 0) return true;
        return ask(`Spend an estimated $${plan.estimatedUsd.toFixed(2)}? [y/N] `);
      },
      onStep: (step) => {
        if (step.label.startsWith("building") || step.stage === "video") {
          console.log(`→ ${step.label}`);
        }
      },
    });
    console.log(formatPlan(result.plan));
    if (result.dryRun && opts.dryRun) return;
    for (const art of result.artifacts) {
      console.log(`wrote ${art.sheetPath}`);
    }
  });

program
  .command("generate")
  .argument("<asset>", "asset id")
  .description("Generate (or re-roll) the reference image for an asset")
  .option("-c, --config <path>", "config file")
  .option("-t, --takes <n>", "number of candidates", "1")
  .action(async (assetId: string, opts: { config?: string; takes: string }) => {
    const cwd = process.cwd();
    const config = await loadConfig(cwd, opts.config);
    const asset = config.assets.find((a) => a.id === assetId);
    if (!asset) throw new Error(`Unknown asset "${assetId}"`);
    const models = resolveModels(config, asset);
    const takes = Number(opts.takes) || 1;
    const images = await generateReference({ config, asset, generator: models.reference, takes });
    const cache = new Cache(resolveWorkDir(config, cwd));
    for (const [i, image] of images.entries()) {
      const path = await cache.saveTake(asset.id, "reference", `${Date.now()}-${i}.png`, image);
      console.log(path);
    }
  });

program
  .command("animate")
  .argument("<asset>", "asset id")
  .argument("<animation>", "animation name")
  .description("Generate a video take for one animation")
  .option("-c, --config <path>", "config file")
  .option("-d, --direction <dir>", "facing", "down")
  .action(async (assetId: string, animation: string, opts: { config?: string; direction: string }) => {
    const cwd = process.cwd();
    const config = await loadConfig(cwd, opts.config);
    const asset = config.assets.find((a) => a.id === assetId);
    if (!asset) throw new Error(`Unknown asset "${assetId}"`);
    const models = resolveModels(config, asset);
    const anim = resolveAnimations(config, asset).find((a) => a.name === animation);
    if (!anim) throw new Error(`Unknown animation "${animation}"`);
    const cache = new Cache(resolveWorkDir(config, cwd));
    const ref =
      (await cache.read(
        cache.key({
          stage: "reference",
          asset: asset.id,
          prompt: asset.prompt,
          style: config.style,
          provider: models.reference.id,
        }),
        "reference.png",
      ));
    if (!ref) {
      throw new Error(`No reference for "${asset.id}". Run \`unspooler generate ${asset.id}\` first.`);
    }
    const dir = opts.direction as ReturnType<typeof resolveDirections>[number];
    const video = await generateVideo({
      config,
      asset,
      animation: anim,
      direction: dir,
      image: ref,
      generator: anim.video ?? models.video,
    });
    const path = await cache.saveTake(asset.id, `${animation}-${dir}`, `${Date.now()}.mp4`, video);
    console.log(path);
  });

program
  .command("export")
  .argument("<target>", "generic | phaser | godot | css")
  .description("Re-export already built sheets into an engine target")
  .option("-c, --config <path>", "config file")
  .action(async (target: string, opts: { config?: string }) => {
    const cwd = process.cwd();
    const config = await loadConfig(cwd, opts.config);
    const outDir = resolveOutDir(config, cwd);
    const exporter = getExporter(target);
    for (const asset of config.assets) {
      const sheetFileName = `${asset.id}.png`;
      const manifestRaw = await readFile(resolve(outDir, `${asset.id}.json`), "utf8").catch(() => null);
      const sheet = await readFile(resolve(outDir, sheetFileName)).catch(() => null);
      if (!manifestRaw || !sheet) {
        console.warn(`skip ${asset.id}: run build first`);
        continue;
      }
      const files = await exporter.export({
        asset,
        manifest: JSON.parse(manifestRaw),
        sheet,
        sheetFileName,
        outDir,
      });
      for (const file of files) console.log(file.path);
    }
  });

program
  .command("bake")
  .argument("<character>", "character asset id (must be built)")
  .description("Re-bake a character's spritesheet locally, optionally wearing equipment — zero AI cost")
  .option("-c, --config <path>", "config file")
  .option("-e, --equip <ids>", "comma-separated equipment asset ids (must be built)", "")
  .option("-o, --out <name>", "output basename (default: <character>+<items>)")
  .action(async (characterId: string, opts: { config?: string; equip: string; out?: string }) => {
    const cwd = process.cwd();
    const config = await loadConfig(cwd, opts.config);
    const outDir = resolveOutDir(config, cwd);
    const asset = config.assets.find((a) => a.id === characterId);
    if (!asset) throw new Error(`Unknown asset "${characterId}"`);
    if (asset.type !== "character") throw new Error(`"${characterId}" is not a character`);

    const { bakeClips, packSheet } = await import("./pipeline/index.js");
    const { cellSize, resolveAnimations: anims, resolveDirections: dirs, resolveFps, exportTargets } =
      await import("./config.js");

    const rigRaw = await readFile(resolve(outDir, `${characterId}.rig.json`), "utf8").catch(() => null);
    if (!rigRaw) throw new Error(`No rig for "${characterId}". Run \`unspooler build -a ${characterId}\` first.`);
    const rig = JSON.parse(rigRaw);
    const atlas = await readFile(resolve(outDir, rig.atlas));

    const equipIds = opts.equip.split(",").map((s) => s.trim()).filter(Boolean);
    const equipment = [];
    for (const id of equipIds) {
      const raw = await readFile(resolve(outDir, `${id}.equip.json`), "utf8").catch(() => null);
      if (!raw) throw new Error(`No built equipment "${id}". Run \`unspooler build -a ${id}\` first.`);
      const manifest = JSON.parse(raw);
      const itemAtlas = await readFile(resolve(outDir, manifest.atlas));
      equipment.push({ manifest, atlas: itemAtlas });
    }

    const clips = await bakeClips({
      rig,
      atlas,
      equipment,
      cell: cellSize(config),
      fps: resolveFps(config, asset),
      animations: anims(config, asset).map((a) => a.name),
      directions: dirs(asset),
      pixelNative: config.style.pixelNative,
      palette: config.style.palette,
    });

    const name = opts.out ?? (equipIds.length ? `${characterId}+${equipIds.join("+")}` : characterId);
    const imageName = `${name}.png`;
    const packed = await packSheet({
      asset: { ...asset, id: name },
      clips,
      cell: cellSize(config),
      fps: resolveFps(config, asset),
      anchorMode: "feet",
      imageName,
    });
    for (const target of exportTargets(config)) {
      const exporter = getExporter(target);
      const files = await exporter.export({
        asset: { ...asset, id: name },
        manifest: packed.manifest,
        sheet: packed.sheet,
        sheetFileName: imageName,
        outDir,
      });
      for (const file of files) console.log(file.path);
    }
  });

program
  .command("studio")
  .description("Open the local review + rig playground")
  .option("-c, --config <path>", "config file")
  .option("-p, --port <n>", "port", "4173")
  .action(async (opts: { config?: string; port: string }) => {
    const { startStudio } = await import("./studio/server.js");
    await startStudio({
      cwd: process.cwd(),
      configPath: opts.config,
      port: Number(opts.port) || 4173,
    });
  });

function collect(value: string, prev: string[]): string[] {
  return prev.concat(value);
}

async function ask(question: string): Promise<boolean> {
  if (!input.isTTY) return false;
  const rl = createInterface({ input, output });
  const answer = await rl.question(question);
  rl.close();
  return /^(y|yes)$/i.test(answer.trim());
}

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
