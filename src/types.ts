export const ASSET_TYPES = ["character", "static", "vfx", "tileset"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const STANDARD_ANIMATIONS = [
  "idle",
  "walk",
  "run",
  "attack",
  "hurt",
  "jump",
  "death",
] as const;
export type StandardAnimation = (typeof STANDARD_ANIMATIONS)[number];

export const DIRECTIONS_4 = ["down", "left", "right", "up"] as const;
export const DIRECTIONS_8 = [
  "down",
  "down-left",
  "left",
  "up-left",
  "up",
  "up-right",
  "right",
  "down-right",
] as const;

export type Direction4 = (typeof DIRECTIONS_4)[number];
export type Direction8 = (typeof DIRECTIONS_8)[number];
export type Direction = Direction8;

export type ChromaMode = "green" | "magenta" | "auto";

export type PresetName = "draft" | "preferred";

export type ExportTarget = "generic" | "phaser" | "godot" | "css" | (string & {});

export type HexColor = string;

export interface StyleConfig {
  /** Style prompt prepended to every generation (art direction, medium, lighting). */
  prompt: string;
  /** Hex colors the project should stay inside. Passed into prompts and pixel-snap. */
  palette?: HexColor[];
  /** Output cell size in pixels (width). Height defaults to the same unless `cellHeight` is set. */
  cellSize?: number;
  cellHeight?: number;
  /** Native pixel-art grid (e.g. 32). Enables the pixel-snap pass when set. */
  pixelNative?: number;
  /** Extra reference images (paths or URLs) used as style consistency for every asset. */
  references?: string[];
}

export interface AnimationSpec {
  name: string;
  prompt?: string;
  /** Override the project fps for this clip. */
  fps?: number;
  loop?: boolean;
  /** Seconds of generated video. */
  duration?: number;
  /** Model override for this animation only. */
  video?: VideoGenerator;
  /** Skip generating a facing; flip the opposite one instead. */
  mirrorFrom?: Direction;
}

export interface AssetModels {
  reference?: ImageGenerator;
  video?: VideoGenerator;
  matte?: BackgroundRemover;
}

export interface AssetConfig {
  id: string;
  type: AssetType;
  prompt: string;
  /** Extra references for this asset (character sheets, previous takes, photos). */
  references?: string[];
  animations?: Array<string | AnimationSpec>;
  /** 1 = no facing variants, 4 or 8 for directional characters. */
  directions?: 1 | 4 | 8;
  /** Generate left, flip for right (and down-left / down-right, etc.). Default true. */
  mirrorHorizontal?: boolean;
  chroma?: ChromaMode;
  fps?: number;
  models?: AssetModels;
  /** Tileset: tile pixel size. */
  tileSize?: number;
  /** Tileset: columns × rows to slice after generation. */
  tileGrid?: { cols: number; rows: number };
}

export interface ExportConfig {
  targets?: ExportTarget[];
  /** Destination for final sheets + manifests. Default `assets`. */
  outDir?: string;
}

export interface CostConfig {
  /** Prompt before spending more than this (USD). Default 1. */
  confirmAboveUsd?: number;
}

export interface UnspoolerConfig {
  style: StyleConfig;
  models?: AssetModels;
  preset?: PresetName;
  assets: AssetConfig[];
  export?: ExportConfig;
  cost?: CostConfig;
  /** Working directory for cache / takes. Default `.unspooler`. */
  workDir?: string;
  fps?: number;
  chroma?: ChromaMode;
}

export interface CostEstimate {
  usd: number;
  unit: string;
  notes?: string;
}

export interface ImageGenInput {
  prompt: string;
  references?: Array<Buffer | string>;
  width?: number;
  height?: number;
  takes?: number;
  chroma?: ChromaMode;
}

export interface ImageGenResult {
  images: Buffer[];
  model: string;
}

export interface VideoGenInput {
  prompt: string;
  image: Buffer | string;
  duration?: number;
  chroma?: ChromaMode;
}

export interface VideoGenResult {
  video: Buffer;
  contentType?: string;
  model: string;
}

export interface MatteInput {
  frames: Buffer[];
  chroma?: ChromaMode;
  variant?: string;
}

export interface MatteResult {
  frames: Buffer[];
  model: string;
}

export interface ImageGenerator {
  kind: "image";
  id: string;
  estimate?(input: ImageGenInput): CostEstimate;
  generate(input: ImageGenInput): Promise<ImageGenResult>;
}

export interface VideoGenerator {
  kind: "video";
  id: string;
  estimate?(input: VideoGenInput): CostEstimate;
  generate(input: VideoGenInput): Promise<VideoGenResult>;
}

export interface BackgroundRemover {
  kind: "matte";
  id: string;
  estimate?(input: MatteInput): CostEstimate;
  remove(input: MatteInput): Promise<MatteResult>;
}

export interface Exporter {
  id: string;
  export(input: ExportInput): Promise<ExportedFile[]>;
}

export interface ExportInput {
  asset: AssetConfig;
  manifest: SpriteManifest;
  sheet: Buffer;
  sheetFileName: string;
  outDir: string;
}

export interface ExportedFile {
  path: string;
  contents?: string | Buffer;
}

export interface SpriteFrame {
  filename: string;
  frame: { x: number; y: number; w: number; h: number };
  rotated: boolean;
  trimmed: boolean;
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
  duration: number;
  anchor: { x: number; y: number };
  animation: string;
  direction?: Direction;
  index: number;
}

export interface SpriteManifest {
  frames: SpriteFrame[];
  meta: {
    app: "unspooler";
    version: string;
    image: string;
    format: "RGBA8888";
    size: { w: number; h: number };
    scale: "1";
    cell: { w: number; h: number };
    fps: number;
    assetId: string;
    assetType: AssetType;
    frameTags: Array<{
      name: string;
      from: number;
      to: number;
      direction: "forward";
      loop: boolean;
    }>;
    anchors: {
      mode: "feet" | "centroid" | "none";
      x: number;
      y: number;
    };
  };
}

export interface LoopWindow {
  in: number;
  out: number;
}

export interface SelectedTake {
  reference?: string;
  animations?: Record<
    string,
    Record<
      string,
      {
        video?: string;
        loop?: LoopWindow;
        matteVariant?: string;
      }
    >
  >;
}

export interface ProjectState {
  selected: Record<string, SelectedTake>;
}

export interface PlanStep {
  assetId: string;
  type: AssetType;
  animation?: string;
  direction?: Direction | "none";
  stage:
    | "reference"
    | "video"
    | "frames"
    | "matte"
    | "normalize"
    | "pack"
    | "tileset"
    | "export";
  cacheHit: boolean;
  cacheKey: string;
  costUsd: number;
  providerId: string;
  label: string;
}

export interface BuildPlan {
  steps: PlanStep[];
  cacheHits: number;
  paidCalls: number;
  estimatedUsd: number;
}

export interface UnspoolOptions {
  cwd?: string;
  dryRun?: boolean;
  yes?: boolean;
  assetIds?: string[];
  confirm?: (plan: BuildPlan) => Promise<boolean>;
  onStep?: (step: PlanStep) => void;
}

export interface BuildArtifact {
  assetId: string;
  sheetPath: string;
  manifestPath: string;
  exports: ExportedFile[];
}

export interface BuildResult {
  plan: BuildPlan;
  artifacts: BuildArtifact[];
  dryRun: boolean;
}

export interface ResolvedAnimation {
  name: string;
  prompt: string;
  fps: number;
  loop: boolean;
  duration: number;
  video?: VideoGenerator;
  mirrorFrom?: Direction;
}
