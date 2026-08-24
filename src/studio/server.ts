import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { Cache, StateStore } from "../cache.js";
import { loadConfig, resolveOutDir, resolveWorkDir } from "../config.js";
import { formatPlan, markCacheHits, planAsset, summarizePlan } from "../cost.js";
import type { ProjectState, UnspoolerConfig } from "../types.js";

export interface StudioOptions {
  cwd: string;
  configPath?: string;
  port: number;
}

function studioDist(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "../../studio"),
    join(here, "../studio"),
    join(process.cwd(), "dist/studio"),
  ];
  return candidates.find((p) => existsSync(join(p, "index.html"))) ?? candidates[0]!;
}

export async function startStudio(options: StudioOptions): Promise<void> {
  const config = await loadConfig(options.cwd, options.configPath);
  const workDir = resolveWorkDir(config, options.cwd);
  const outDir = resolveOutDir(config, options.cwd);
  const cache = new Cache(workDir);
  const state = new StateStore(workDir);
  const app = createStudioApp({ config, workDir, outDir, cache, state, cwd: options.cwd });

  serve({ fetch: app.fetch, port: options.port }, (info) => {
    console.log(`Unspooler studio → http://localhost:${info.port}`);
  });
}

export function createStudioApp(ctx: {
  config: UnspoolerConfig;
  workDir: string;
  outDir: string;
  cache: Cache;
  state: StateStore;
  cwd: string;
}): Hono {
  const app = new Hono();
  app.use("*", cors());

  app.get("/api/project", async (c) => {
    const steps = ctx.config.assets.flatMap((asset) => planAsset(ctx.config, asset));
    const marked = await markCacheHits(steps, ctx.cache);
    const plan = summarizePlan(marked);
    return c.json({
      style: ctx.config.style,
      preset: ctx.config.preset ?? "preferred",
      assets: ctx.config.assets.map((a) => ({
        id: a.id,
        type: a.type,
        prompt: a.prompt,
        animations: a.animations ?? [],
        directions: a.directions ?? (a.type === "character" ? 4 : 1),
      })),
      plan,
      planText: formatPlan(plan),
      outDir: ctx.outDir,
      workDir: ctx.workDir,
    });
  });

  app.get("/api/state", async (c) => c.json(await ctx.state.load()));

  app.post("/api/state", async (c) => {
    const body = (await c.req.json()) as ProjectState;
    await ctx.state.save(body);
    return c.json(body);
  });

  app.get("/api/artifacts", async (c) => {
    const items = [];
    for (const asset of ctx.config.assets) {
      const sheet = join(ctx.outDir, `${asset.id}.png`);
      const manifest = join(ctx.outDir, `${asset.id}.json`);
      items.push({
        id: asset.id,
        sheet: existsSync(sheet) ? `/files/out/${asset.id}.png` : null,
        manifest: existsSync(manifest) ? `/files/out/${asset.id}.json` : null,
      });
    }
    return c.json(items);
  });

  app.get("/api/takes/:asset", async (c) => {
    const asset = c.req.param("asset");
    const root = join(ctx.workDir, "takes", asset);
    if (!existsSync(root)) return c.json({ takes: [] });
    const takes = await listFiles(root);
    return c.json({
      takes: takes.map((rel) => ({
        path: rel,
        url: `/files/work/takes/${asset}/${rel}`,
      })),
    });
  });

  app.get("/files/out/*", async (c) => {
    const rel = c.req.path.replace("/files/out/", "");
    return fileResponse(resolve(ctx.outDir, rel));
  });

  app.get("/files/work/*", async (c) => {
    const rel = c.req.path.replace("/files/work/", "");
    return fileResponse(resolve(ctx.workDir, rel));
  });

  const dist = studioDist();
  if (existsSync(join(dist, "index.html"))) {
    app.use("/*", serveStatic({ root: dist }));
    app.get("*", async (c) => {
      const html = await readFile(join(dist, "index.html"), "utf8");
      return c.html(html);
    });
  } else {
    app.get("*", (c) =>
      c.html(`<!doctype html><html><body style="font-family:sans-serif;padding:2rem">
        <h1>Unspooler studio</h1>
        <p>Studio UI is not built. Run <code>npm run build</code> in the unspooler package.</p>
        <pre id="p"></pre>
        <script>fetch('/api/project').then(r=>r.json()).then(j=>p.textContent=j.planText)</script>
      </body></html>`),
    );
  }

  return app;
}

async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listFiles(join(root, entry.name), rel)));
    else out.push(rel);
  }
  return out;
}

async function fileResponse(path: string): Promise<Response> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return new Response("Not found", { status: 404 });
    const data = await readFile(path);
    const mime =
      {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".json": "application/json",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".js": "text/javascript",
        ".css": "text/css",
      }[extname(path)] ?? "application/octet-stream";
    return new Response(new Uint8Array(data), { headers: { "content-type": mime } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
