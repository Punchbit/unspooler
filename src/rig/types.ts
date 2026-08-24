/**
 * Rig / skeletal types. Coordinate conventions used everywhere in the rig
 * system:
 *
 * - Units: 1.0 = total character height. Pixel scale is decided at fit time.
 * - Origin: the character's feet center. +x is right, +y is down, so the top
 *   of the head sits near y = -1.
 * - Rotations are radians, positive clockwise (screen space), 0 = the bone's
 *   rest direction.
 */

export type Vec2 = { x: number; y: number };

export type Facing = "down" | "side" | "up";
export const FACINGS: readonly Facing[] = ["down", "side", "up"] as const;

export type BoneName =
  | "root"
  | "hips"
  | "torso"
  | "head"
  | "arm.L"
  | "hand.L"
  | "arm.R"
  | "hand.R"
  | "leg.L"
  | "foot.L"
  | "leg.R"
  | "foot.R";

export type PartName =
  | "head"
  | "torso"
  | "arm.L"
  | "hand.L"
  | "arm.R"
  | "hand.R"
  | "leg.L"
  | "foot.L"
  | "leg.R"
  | "foot.R";

export interface BoneSpec {
  name: BoneName;
  parent: BoneName | null;
  /** Rest offset from the parent bone origin, in character-height units. */
  position: Vec2;
  /** Rest length in units, pointing down (+y) before rotation. Cosmetic/fit hint. */
  length: number;
}

export interface PartSpec {
  name: PartName;
  bone: BoneName;
  /**
   * Where the bone origin sits inside the part image, as fractions of the
   * trimmed part bounds (0,0 = top-left, 1,1 = bottom-right).
   */
  pivot: Vec2;
  /** Expected share of character height, used to sanity-check segmentation. */
  approxHeight: number;
}

export type SlotName = "head" | "body" | "hand.main" | "hand.off" | "feet";

export interface SlotSpec {
  name: SlotName;
  /** Bone the equipment follows (overlay mode). */
  bone: BoneName;
  /** Default offset from the bone origin, in units. */
  offset: Vec2;
  /**
   * Z bias per facing, added on top of the bone's part z. Positive draws in
   * front, negative behind. Magnitudes ≥ 100 jump in front of / behind the
   * whole body.
   */
  zBias: Record<Facing, number>;
  /** Parts this slot hides when the equipment replaces them (e.g. boots). */
  replaces?: PartName[];
}

export interface SkeletonSpec {
  id: string;
  version: number;
  bones: BoneSpec[];
  parts: PartSpec[];
  /** Back-to-front part order per facing. Index = base z. */
  drawOrder: Record<Facing, PartName[]>;
  slots: Record<SlotName, SlotSpec>;
  /** Layout of the generated parts sheet: reading-order part names per grid cell. */
  sheetLayout: { cols: number; rows: number; order: PartName[] };
}

/* ------------------------------ animation ------------------------------ */

export interface Keyframe {
  /** Normalized clip time in [0, 1]. */
  t: number;
  value: number;
}

export interface Vec2Keyframe {
  t: number;
  value: Vec2;
}

export interface BoneTrack {
  /** Rotation offsets from rest, radians. */
  rotation?: Keyframe[];
  /** Translation offsets from rest position, units. */
  position?: Vec2Keyframe[];
}

export interface AnimationClip {
  name: string;
  /** One cycle, in milliseconds. */
  durationMs: number;
  loop: boolean;
  tracks: Partial<Record<BoneName, BoneTrack>>;
}

/* ------------------------------- manifest ------------------------------ */

export interface RigFrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RigPartFrame {
  frame: RigFrameRect;
  /** Pixel offset of the bone origin inside the frame rect. */
  pivot: Vec2;
}

export interface RigFacing {
  parts: Partial<Record<PartName, RigPartFrame>>;
}

export interface RigManifest {
  app: "unspooler";
  kind: "rig";
  version: string;
  assetId: string;
  skeleton: { id: string; version: number };
  /** Atlas image filename, packed parts for every facing. */
  atlas: string;
  atlasSize: { w: number; h: number };
  /** Character height in atlas pixels — converts units to pixels. */
  pixelHeight: number;
  facings: Partial<Record<Facing, RigFacing>>;
  animations: string[];
  fps: number;
}

/* ------------------------------ equipment ------------------------------ */

export type EquipmentMode = "overlay" | "replace";

export interface EquipmentFacingArt {
  frame: RigFrameRect;
  /** Pixel offset of the attachment point (grip/anchor) inside the frame. */
  pivot: Vec2;
}

export interface EquipmentManifest {
  app: "unspooler";
  kind: "equipment";
  version: string;
  assetId: string;
  slot: SlotName;
  mode: EquipmentMode;
  atlas: string;
  atlasSize: { w: number; h: number };
  /** Height of the item in pixels of the character-height scale it was fit to. */
  pixelHeight: number;
  /** Extra offset from the slot's default attachment, in units. */
  gripOffset?: Vec2;
  /** Extra rotation applied on top of the bone, radians. */
  rotation?: number;
  facings: Partial<Record<Facing, EquipmentFacingArt>>;
  /** Overrides slot default when replacing parts (e.g. only foot.L). */
  replaces?: PartName[];
}

/** Per-facing, per-part user corrections persisted from the Studio inspector. */
export type RigOverrides = Partial<
  Record<Facing, Partial<Record<PartName, { pivot?: Vec2 }>>>
>;

/* -------------------------------- drawing ------------------------------ */

export interface DrawCommand {
  kind: "part" | "equipment";
  /** Part name, or equipment asset id. */
  id: string;
  /** Atlas rect to sample (part atlas or the equipment's own atlas). */
  frame: RigFrameRect;
  /** For equipment: which atlas. Parts always use the rig atlas. */
  atlas?: string;
  /** Pixel position of the frame's pivot, relative to the feet-center origin. */
  x: number;
  y: number;
  /** Radians, clockwise, applied around the pivot. */
  rotation: number;
  /** Uniform scale from atlas pixels to output pixels. */
  scale: number;
  /** Mirror the whole pose horizontally (right-facing renders). */
  flipX: boolean;
  z: number;
  /** Pixel offset of the pivot inside the frame rect. */
  pivot: Vec2;
}
