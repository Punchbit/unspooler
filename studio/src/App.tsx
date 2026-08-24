import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchArtifacts,
  fetchManifest,
  fetchProject,
  fetchTakes,
  type Artifact,
  type ProjectPayload,
} from "./api";
import { bindKeys, CharacterController } from "@controller";
import type { SpriteManifest } from "../../src/types";

type Tab = "project" | "takes" | "frames" | "rig";

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
          <small>review takes · mark loops · drive the rig</small>
        </div>
        <nav>
          {(["project", "takes", "frames", "rig"] as Tab[]).map((id) => (
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

function RigView({ artifacts }: { artifacts: Artifact[] }) {
  const ready = artifacts.filter((a) => a.sheet && a.manifest);
  const [id, setId] = useState(ready[0]?.id ?? "");
  const artifact = ready.find((a) => a.id === id);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState({ state: "idle", direction: "down", x: 0, y: 0 });

  const sheetUrl = artifact?.sheet ?? null;

  useEffect(() => {
    if (!artifact?.manifest || !sheetUrl) return;
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
  }, [artifact?.manifest, sheetUrl]);

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
    </div>
  );
}
