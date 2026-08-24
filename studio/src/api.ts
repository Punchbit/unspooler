export interface ProjectPayload {
  style: { prompt: string; palette?: string[]; pixelNative?: number; cellSize?: number };
  preset: string;
  assets: Array<{
    id: string;
    type: string;
    prompt: string;
    animations: unknown[];
    directions: number;
  }>;
  plan: {
    steps: Array<{ label: string; costUsd: number; cacheHit: boolean; stage: string; assetId: string }>;
    cacheHits: number;
    paidCalls: number;
    estimatedUsd: number;
  };
  planText: string;
  outDir: string;
  workDir: string;
}

export interface Artifact {
  id: string;
  type: string;
  slot: string | null;
  sheet: string | null;
  manifest: string | null;
  rig: string | null;
  rigAtlas: string | null;
  equip: string | null;
  equipAtlas: string | null;
}

export interface ProjectState {
  selected: Record<
    string,
    {
      reference?: string;
      animations?: Record<
        string,
        Record<string, { video?: string; loop?: { in: number; out: number }; matteVariant?: string }>
      >;
      rig?: Record<string, Record<string, { pivot?: { x: number; y: number } }>>;
    }
  >;
}

export async function fetchProject(): Promise<ProjectPayload> {
  const res = await fetch("/api/project");
  if (!res.ok) throw new Error("Could not load project");
  return res.json();
}

export async function fetchArtifacts(): Promise<Artifact[]> {
  const res = await fetch("/api/artifacts");
  return res.json();
}

export async function fetchTakes(assetId: string): Promise<{ path: string; url: string }[]> {
  const res = await fetch(`/api/takes/${encodeURIComponent(assetId)}`);
  const json = await res.json();
  return json.takes ?? [];
}

export async function fetchState(): Promise<ProjectState> {
  const res = await fetch("/api/state");
  return res.json();
}

export async function saveState(state: ProjectState): Promise<void> {
  await fetch("/api/state", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(state),
  });
}

export async function fetchManifest(url: string): Promise<unknown> {
  const res = await fetch(url);
  return res.json();
}
