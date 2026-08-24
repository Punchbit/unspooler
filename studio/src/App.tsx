import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchArtifacts,
  fetchManifest,
  fetchProject,
  fetchState,
  fetchTakes,
  saveState,
  type Artifact,
  type ProjectPayload,
  type ProjectState,
} from "./api";
import {
  bindKeys,
  CharacterController,
  CORE_CLIP_NAMES,
  HUMANOID,
  RigPlayer,
  type DrawCommand,
  type EquipmentManifest,
  type Facing,
  type PartName,
  type RigManifest,
  type SlotName,
} from "@controller";
import type { SpriteManifest } from "../../src/types";

type Tab = "project" | "takes" | "frames" | "parts" | "rig";

export function App() {
  const [tab, setTab] = useState<Tab>("project");
  const [project, setProject] = useState<ProjectPayload | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchProject(), fetchArtifacts()])
      .then(([p, a]) => {
        setProject(p);
        setArtifacts(a);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <h1>Unspooler</h1>
          <small>review takes · fix pivots · equip items · drive the rig</small>
        </div>
        <nav>
          {(["project", "takes", "frames", "parts", "rig"] as Tab[]).map((id) => (
            <button
              key={id}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
            >
              {id}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {error && <p className="err">{error}</p>}
        {!project && !error && <p className="muted">loading project…</p>}
        {project && tab === "project" && <ProjectView project={project} artifacts={artifacts} />}
        {project && tab === "takes" && <TakesView project={project} />}
        {project && tab === "frames" && <FramesView artifacts={artifacts} />}
        {project && tab === "parts" && <PartsView artifacts={artifacts} />}
        {project && tab === "rig" && <RigView artifacts={artifacts} />}
      </main>
    </div>
  );
}

function ProjectView({ project, artifacts }: { project: ProjectPayload; artifacts: Artifact[] }) {
  return (
    <div className="grid">
      <section>
        <h2>Style</h2>
        <p>{project.style.prompt}</p>
        {project.style.palette && (
          <div className="swatches">
            {project.style.palette.map((hex) => (
              <span key={hex} style={{ background: hex }} title={hex} />
            ))}
          </div>
        )}
        <p className="muted">
          preset {project.preset}
          {project.style.pixelNative ? ` · pixel native ${project.style.pixelNative}` : ""}
          {` · cell ${project.style.cellSize ?? 256}`}
        </p>
      </section>
      <section className="cards">
        {project.assets.map((asset) => {
          const built = artifacts.find((a) => a.id === asset.id);
          return (
            <article className="card" key={asset.id}>
              <h3>{asset.id}</h3>
              <p className="muted">
                {asset.type} · {asset.directions} dir
              </p>
              <p>{asset.prompt}</p>
              {built?.sheet ? (
                <p>
                  <a href={built.sheet}>sheet</a>
                  {built.manifest ? (
                    <>
                      {" · "}
                      <a href={built.manifest}>manifest</a>
                    </>
                  ) : null}
                  {built.rig ? (
                    <>
                      {" · "}
                      <a href={built.rig}>rig</a>
                    </>
                  ) : null}
                </p>
              ) : (
                <p className="muted">not built yet</p>
              )}
            </article>
          );
        })}
      </section>
      <section>
        <h2>Build plan</h2>
        <p className="muted">
          {project.plan.paidCalls} paid · {project.plan.cacheHits} cache · $
          {project.plan.estimatedUsd.toFixed(2)}
        </p>
        <pre className="plan">{project.planText}</pre>
      </section>
    </div>
  );
}

function TakesView({ project }: { project: ProjectPayload }) {
  const [assetId, setAssetId] = useState(project.assets[0]?.id ?? "");
  const [takes, setTakes] = useState<{ path: string; url: string }[]>([]);

  useEffect(() => {
    if (!assetId) return;
    fetchTakes(assetId).then(setTakes);
  }, [assetId]);

  return (
    <div className="grid">
      <label>
        asset{" "}
        <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
          {project.assets.map((a) => (
            <option key={a.id}>{a.id}</option>
          ))}
        </select>
      </label>
      {!takes.length && <p className="muted">No takes in .unspooler/takes/{assetId}</p>}
      <div className="takes">
        {takes.map((take) => {
          const video = /\.(mp4|webm)$/i.test(take.path);
          return (
            <figure key={take.path}>
              {video ? <video src={take.url} controls muted /> : <img src={take.url} alt={take.path} />}
              <figcaption>{take.path}</figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}

function FramesView({ artifacts }: { artifacts: Artifact[] }) {
  const ready = artifacts.filter((a) => a.sheet);
  const [id, setId] = useState(ready[0]?.id ?? "");
  const [manifest, setManifest] = useState<SpriteManifest | null>(null);
  const [frame, setFrame] = useState(0);

  const artifact = ready.find((a) => a.id === id);

  useEffect(() => {
    if (!artifact?.manifest) return;
    fetchManifest(artifact.manifest).then((m) => {
      setManifest(m as SpriteManifest);
      setFrame(0);
    });
  }, [artifact?.manifest]);

  if (!ready.length) return <p className="muted">Build an asset first (`unspooler build`).</p>;

  const current = manifest?.frames[frame];
  const cell = manifest?.meta.cell;

  return (
    <div className="grid">
      <label>
        asset{" "}
        <select value={id} onChange={(e) => setId(e.target.value)}>
          {ready.map((a) => (
            <option key={a.id}>{a.id}</option>
          ))}
        </select>
      </label>
      {current && cell && artifact?.sheet && (
        <>
          <div
            style={{
              width: cell.w,
              height: cell.h,
              backgroundImage: `url(${artifact.sheet})`,
              backgroundPosition: `-${current.frame.x}px -${current.frame.y}px`,
              imageRendering: "pixelated",
              border: "1px solid #3a3226",
            }}
          />
          <input
            type="range"
            min={0}
            max={Math.max(0, (manifest?.frames.length ?? 1) - 1)}
            value={frame}
            onChange={(e) => setFrame(Number(e.target.value))}
          />
          <p className="muted">
            {current.filename} · {current.animation}
            {current.direction ? `/${current.direction}` : ""} · frame {frame + 1}/
            {manifest?.frames.length}
          </p>
        </>
      )}
    </div>
  );
}

/** Paint a RigPlayer draw list onto a canvas. Origin = feet center at (ox, oy). */
function paintCommands(
  ctx: CanvasRenderingContext2D,
  commands: DrawCommand[],
  images: Map<string, HTMLImageElement>,
  ox: number,
  oy: number,
  posScale: number,
) {
  for (const c of commands) {
    const img = images.get(c.atlas ?? "__rig__");
    if (!img || !img.complete) continue;
    ctx.save();
    ctx.translate(ox + c.x * posScale, oy + c.y * posScale);
    ctx.rotate(c.rotation);
    const s = c.scale;
    if (c.flipX) {
      ctx.scale(-1, 1);
      ctx.drawImage(
        img,
        c.frame.x,
        c.frame.y,
        c.frame.w,
        c.frame.h,
        (c.pivot.x - c.frame.w) * s,
        -c.pivot.y * s,
        c.frame.w * s,
        c.frame.h * s,
      );
    } else {
      ctx.drawImage(
        img,
        c.frame.x,
        c.frame.y,
        c.frame.w,
        c.frame.h,
        -c.pivot.x * s,
        -c.pivot.y * s,
        c.frame.w * s,
        c.frame.h * s,
      );
    }
    ctx.restore();
  }
}

function useImage(url: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) {
      setImg(null);
      return;
    }
    const image = new Image();
    image.onload = () => setImg(image);
    image.src = url;
  }, [url]);
  return img;
}

/**
 * Rig inspector: check the segmented parts, click to correct pivots (saved to
 * state.json — the next build applies them), and preview any library clip.
 */
function PartsView({ artifacts }: { artifacts: Artifact[] }) {
  const rigged = artifacts.filter((a) => a.rig && a.rigAtlas);
  const [id, setId] = useState(rigged[0]?.id ?? "");
  const artifact = rigged.find((a) => a.id === id);
  const [rig, setRig] = useState<RigManifest | null>(null);
  const [facing, setFacing] = useState<Facing>("down");
  const [part, setPart] = useState<PartName>("head");
  const [clip, setClip] = useState("walk");
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const atlas = useImage(artifact?.rigAtlas ?? null);
  const overridesRef = useRef<Record<string, Record<string, { pivot: { x: number; y: number } }>>>({});

  useEffect(() => {
    if (!artifact?.rig) return;
    fetchManifest(artifact.rig).then((r) => {
      setRig(r as RigManifest);
      overridesRef.current = {};
      setDirty(false);
    });
  }, [artifact?.rig]);

  const facings = useMemo(() => (rig ? (Object.keys(rig.facings) as Facing[]) : []), [rig]);
  const art = rig?.facings[facing]?.parts[part];

  const partCanvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = partCanvas.current;
    if (!canvas || !rig || !art || !atlas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const zoom = Math.min(4, 220 / Math.max(art.frame.w, art.frame.h));
    canvas.width = Math.round(art.frame.w * zoom);
    canvas.height = Math.round(art.frame.h * zoom);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(atlas, art.frame.x, art.frame.y, art.frame.w, art.frame.h, 0, 0, canvas.width, canvas.height);
    // Pivot crosshair.
    const px = art.pivot.x * zoom;
    const py = art.pivot.y * zoom;
    ctx.strokeStyle = "#ff5470";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px - 8, py);
    ctx.lineTo(px + 8, py);
    ctx.moveTo(px, py - 8);
    ctx.lineTo(px, py + 8);
    ctx.stroke();
    ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
  }, [rig, art, atlas, dirty]);

  const onPickPivot = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = partCanvas.current;
      if (!canvas || !rig || !art) return;
      const rect = canvas.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width;
      const fy = (e.clientY - rect.top) / rect.height;
      // Live-update the loaded manifest so the crosshair + preview react now.
      art.pivot.x = fx * art.frame.w;
      art.pivot.y = fy * art.frame.h;
      const forFacing = (overridesRef.current[facing] ??= {});
      forFacing[part] = { pivot: { x: fx, y: fy } };
      setDirty(true);
      setSaved(false);
    },
    [rig, art, facing, part],
  );

  const onSave = useCallback(async () => {
    if (!artifact) return;
    const state: ProjectState = await fetchState();
    const selected = (state.selected[artifact.id] ??= {});
    const rigState = (selected.rig ??= {});
    for (const [f, parts] of Object.entries(overridesRef.current)) {
      rigState[f] = { ...(rigState[f] ?? {}), ...parts };
    }
    await saveState(state);
    setSaved(true);
    setDirty(false);
  }, [artifact]);

  // Clip preview: play the selected library clip on this rig.
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = previewCanvas.current;
    if (!canvas || !rig || !atlas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = 260;
    canvas.height = 260;
    ctx.imageSmoothingEnabled = false;
    const player = new RigPlayer(rig);
    const images = new Map([["__rig__", atlas]]);
    const scale = (canvas.height * 0.55) / rig.pixelHeight;
    const direction = facing === "side" ? "left" : facing;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const commands = player.drawList(clip, now - start, direction, { scale });
      paintCommands(ctx, commands, images, canvas.width / 2, canvas.height * 0.78, scale);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rig, atlas, clip, facing, dirty]);

  if (!rigged.length) {
    return <p className="muted">Build a character first — the rig inspector needs a *.rig.json.</p>;
  }

  return (
    <div className="rig-wrap">
      <div>
        <label>
          character{" "}
          <select value={id} onChange={(e) => setId(e.target.value)}>
            {rigged.map((a) => (
              <option key={a.id}>{a.id}</option>
            ))}
          </select>
        </label>{" "}
        <label>
          facing{" "}
          <select value={facing} onChange={(e) => setFacing(e.target.value as Facing)}>
            {facings.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>{" "}
        <label>
          part{" "}
          <select value={part} onChange={(e) => setPart(e.target.value as PartName)}>
            {HUMANOID.parts.map((p) => (
              <option key={p.name}>{p.name}</option>
            ))}
          </select>
        </label>
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginTop: 12 }}>
          <figure style={{ margin: 0 }}>
            <canvas
              ref={partCanvas}
              onClick={onPickPivot}
              style={{ cursor: "crosshair", imageRendering: "pixelated" }}
            />
            <figcaption className="muted">click to move the pivot (bone attachment)</figcaption>
          </figure>
          <figure style={{ margin: 0 }}>
            <canvas ref={previewCanvas} style={{ background: "#1d2230", borderRadius: 8 }} />
            <figcaption className="muted">
              <select value={clip} onChange={(e) => setClip(e.target.value)}>
                {CORE_CLIP_NAMES.map((n: string) => (
                  <option key={n}>{n}</option>
                ))}
              </select>{" "}
              live clip preview
            </figcaption>
          </figure>
        </div>
        <p>
          <button onClick={onSave} disabled={!dirty}>
            save pivot corrections
          </button>{" "}
          {saved && <span className="muted">saved — run `unspooler build` to re-fit and re-bake</span>}
        </p>
      </div>
      {rig && (
        <dl className="hud">
          <dt>skeleton</dt>
          <dd>
            {rig.skeleton.id}@{rig.skeleton.version}
          </dd>
          <dt>pixel height</dt>
          <dd>{rig.pixelHeight}</dd>
          <dt>facings</dt>
          <dd>{facings.join(", ")}</dd>
          <dt>animations</dt>
          <dd>{rig.animations.join(", ")}</dd>
        </dl>
      )}
    </div>
  );
}

function RigView({ artifacts }: { artifacts: Artifact[] }) {
  const rigged = artifacts.filter((a) => a.rig && a.rigAtlas);
  const sheetOnly = artifacts.filter((a) => a.sheet && a.manifest && !a.rig);
  const ready = [...rigged, ...sheetOnly];
  const equipables = artifacts.filter((a) => a.equip && a.equipAtlas);

  const [id, setId] = useState(ready[0]?.id ?? "");
  const [worn, setWorn] = useState<Set<string>>(new Set());
  const artifact = ready.find((a) => a.id === id);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<CharacterController | null>(null);
  const [hud, setHud] = useState({ state: "idle", direction: "down", x: 0, y: 0 });

  const isRig = Boolean(artifact?.rig);
  const sheetUrl = artifact?.sheet ?? null;

  // Skeletal playground.
  useEffect(() => {
    if (!artifact?.rig || !artifact.rigAtlas) return;
    let dead = false;
    let raf = 0;
    const held = new Set<string>();
    const onDown = (e: KeyboardEvent) => held.add(e.key.toLowerCase());
    const onUp = (e: KeyboardEvent) => held.delete(e.key.toLowerCase());
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);

    const images = new Map<string, HTMLImageElement>();
    const atlasImg = new Image();
    atlasImg.src = artifact.rigAtlas;
    images.set("__rig__", atlasImg);

    (async () => {
      const rig = (await fetchManifest(artifact.rig!)) as RigManifest;
      if (dead) return;
      const player = new RigPlayer(rig);
      const controller = new CharacterController();
      controller.attachRig(player);
      controller.x = 240;
      controller.y = 220;
      controllerRef.current = controller;

      // Load whatever is currently checked.
      for (const itemArtifact of equipables) {
        if (!worn.has(itemArtifact.id)) continue;
        const manifest = (await fetchManifest(itemArtifact.equip!)) as EquipmentManifest;
        const img = new Image();
        img.src = itemArtifact.equipAtlas!;
        images.set(manifest.atlas, img);
        player.equip(manifest);
      }

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      ctx.imageSmoothingEnabled = false;
      const scale = 140 / rig.pixelHeight;
      let last = performance.now();

      const tick = (now: number) => {
        const dt = now - last;
        last = now;
        const snap = controller.update(bindKeys(held), dt);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#2a241a";
        for (let x = 0; x < canvas.width; x += 32) {
          ctx.fillRect(x, canvas.height - 48, 16, 2);
        }
        paintCommands(ctx, controller.drawList(scale), images, snap.x, snap.y, scale);
        setHud({ state: snap.state, direction: snap.direction, x: snap.x, y: snap.y });
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })();

    return () => {
      dead = true;
      controllerRef.current = null;
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact?.rig, artifact?.rigAtlas, worn]);

  // Fallback: baked-sheet playground for non-rig assets.
  useEffect(() => {
    if (isRig || !artifact?.manifest || !sheetUrl) return;
    let dead = false;
    let raf = 0;
    const held = new Set<string>();
    const onDown = (e: KeyboardEvent) => held.add(e.key.toLowerCase());
    const onUp = (e: KeyboardEvent) => held.delete(e.key.toLowerCase());
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);

    const sheet = new Image();
    sheet.src = sheetUrl;

    fetchManifest(artifact.manifest).then((raw) => {
      if (dead) return;
      const manifest = raw as SpriteManifest;
      const controller = new CharacterController(manifest);
      controller.x = 240;
      controller.y = 200;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      ctx.imageSmoothingEnabled = false;
      let last = performance.now();
      let frameClock = 0;
      let frameIndex = 0;

      const tick = (now: number) => {
        const dt = now - last;
        last = now;
        const snap = controller.update(bindKeys(held), dt);
        const frames = controller.currentFrames();
        if (frames.length) {
          frameClock += dt;
          const dur = frames[0]!.duration || 100;
          if (frameClock >= dur) {
            frameClock = 0;
            frameIndex = (frameIndex + 1) % frames.length;
          }
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#2a241a";
        for (let x = 0; x < canvas.width; x += 32) {
          ctx.fillRect(x, canvas.height - 48, 16, 2);
        }
        if (sheet.complete && frames[frameIndex]) {
          const f = frames[frameIndex]!;
          ctx.drawImage(
            sheet,
            f.frame.x,
            f.frame.y,
            f.frame.w,
            f.frame.h,
            snap.x - f.anchor.x,
            snap.y - f.anchor.y,
            f.frame.w,
            f.frame.h,
          );
        }
        setHud({ state: snap.state, direction: snap.direction, x: snap.x, y: snap.y });
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });

    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [isRig, artifact?.manifest, sheetUrl]);

  const toggleWorn = useCallback((itemId: string) => {
    setWorn((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  const hint = useMemo(() => "WASD / arrows move · space attack · shift jump", []);

  if (!ready.length) return <p className="muted">Build a character sheet, then come back to the rig.</p>;

  return (
    <div className="rig-wrap">
      <div>
        <label>
          asset{" "}
          <select value={id} onChange={(e) => setId(e.target.value)}>
            {ready.map((a) => (
              <option key={a.id}>{a.id}</option>
            ))}
          </select>
        </label>
        <canvas className="rig" ref={canvasRef} />
        <p className="muted">{hint}</p>
      </div>
      <div>
        <dl className="hud">
          <dt>state</dt>
          <dd>{hud.state}</dd>
          <dt>facing</dt>
          <dd>{hud.direction}</dd>
          <dt>pos</dt>
          <dd>
            {hud.x.toFixed(0)}, {hud.y.toFixed(0)}
          </dd>
        </dl>
        {isRig && (
          <section>
            <h2>Equipment</h2>
            {!equipables.length && (
              <p className="muted">No built equipment. Add a `type: "equipment"` asset and build it.</p>
            )}
            {equipables.map((item) => (
              <label key={item.id} style={{ display: "block" }}>
                <input
                  type="checkbox"
                  checked={worn.has(item.id)}
                  onChange={() => toggleWorn(item.id)}
                />{" "}
                {item.id}
                <span className="muted">{item.slot ? ` · ${item.slot as SlotName}` : ""}</span>
              </label>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
