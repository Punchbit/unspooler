import type { Direction } from "../types.js";
import type {
  BoneName,
  BoneSpec,
  Facing,
  PartName,
  SkeletonSpec,
  SlotName,
  SlotSpec,
} from "./types.js";

/**
 * The standard unspooler humanoid skeleton, version 1.
 *
 * Every generated character fits this skeleton, which is what lets one
 * animation library and one equipment format work across all of them.
 * ".L" / ".R" are screen-space left/right when the character faces the
 * camera (facing "down"). The side facing is authored facing LEFT; right
 * is a horizontal mirror.
 */

const BONES: BoneSpec[] = [
  { name: "root", parent: null, position: { x: 0, y: 0 }, length: 0 },
  { name: "hips", parent: "root", position: { x: 0, y: -0.48 }, length: 0.05 },
  { name: "torso", parent: "hips", position: { x: 0, y: 0 }, length: 0.38 },
  { name: "head", parent: "torso", position: { x: 0, y: -0.38 }, length: 0.24 },
  { name: "arm.L", parent: "torso", position: { x: -0.11, y: -0.34 }, length: 0.26 },
  { name: "hand.L", parent: "arm.L", position: { x: 0, y: 0.26 }, length: 0.08 },
  { name: "arm.R", parent: "torso", position: { x: 0.11, y: -0.34 }, length: 0.26 },
  { name: "hand.R", parent: "arm.R", position: { x: 0, y: 0.26 }, length: 0.08 },
  { name: "leg.L", parent: "hips", position: { x: -0.07, y: 0 }, length: 0.44 },
  { name: "foot.L", parent: "leg.L", position: { x: 0, y: 0.44 }, length: 0.06 },
  { name: "leg.R", parent: "hips", position: { x: 0.07, y: 0 }, length: 0.44 },
  { name: "foot.R", parent: "leg.R", position: { x: 0, y: 0.44 }, length: 0.06 },
];

const PARTS: SkeletonSpec["parts"] = [
  { name: "head", bone: "head", pivot: { x: 0.5, y: 0.92 }, approxHeight: 0.28 },
  { name: "torso", bone: "torso", pivot: { x: 0.5, y: 0.94 }, approxHeight: 0.42 },
  { name: "arm.L", bone: "arm.L", pivot: { x: 0.5, y: 0.1 }, approxHeight: 0.3 },
  { name: "hand.L", bone: "hand.L", pivot: { x: 0.5, y: 0.15 }, approxHeight: 0.1 },
  { name: "arm.R", bone: "arm.R", pivot: { x: 0.5, y: 0.1 }, approxHeight: 0.3 },
  { name: "hand.R", bone: "hand.R", pivot: { x: 0.5, y: 0.15 }, approxHeight: 0.1 },
  { name: "leg.L", bone: "leg.L", pivot: { x: 0.5, y: 0.08 }, approxHeight: 0.44 },
  { name: "foot.L", bone: "foot.L", pivot: { x: 0.5, y: 0.35 }, approxHeight: 0.1 },
  { name: "leg.R", bone: "leg.R", pivot: { x: 0.5, y: 0.08 }, approxHeight: 0.44 },
  { name: "foot.R", bone: "foot.R", pivot: { x: 0.5, y: 0.35 }, approxHeight: 0.1 },
];

/** Back-to-front. Index in the array is the base z of the part. */
const DRAW_ORDER: Record<Facing, PartName[]> = {
  down: [
    "arm.L",
    "hand.L",
    "arm.R",
    "hand.R",
    "leg.L",
    "foot.L",
    "leg.R",
    "foot.R",
    "torso",
    "head",
  ],
  // Authored facing left: the character's screen-right side (.R) is far.
  side: [
    "arm.R",
    "hand.R",
    "leg.R",
    "foot.R",
    "torso",
    "head",
    "leg.L",
    "foot.L",
    "arm.L",
    "hand.L",
  ],
  up: [
    "hand.L",
    "arm.L",
    "hand.R",
    "arm.R",
    "leg.L",
    "foot.L",
    "leg.R",
    "foot.R",
    "torso",
    "head",
  ],
};

const SLOTS: Record<SlotName, SlotSpec> = {
  head: {
    name: "head",
    bone: "head",
    offset: { x: 0, y: -0.16 },
    zBias: { down: 1, side: 1, up: 1 },
  },
  body: {
    name: "body",
    bone: "torso",
    offset: { x: 0, y: -0.2 },
    zBias: { down: 1, side: 1, up: 1 },
  },
  "hand.main": {
    name: "hand.main",
    bone: "hand.R",
    offset: { x: 0, y: 0.04 },
    // Front view: weapon in front of everything. Back view: behind everything.
    // Side (facing left): main hand is the far side, tucked behind the torso.
    zBias: { down: 100, side: -100, up: -100 },
  },
  "hand.off": {
    name: "hand.off",
    bone: "hand.L",
    offset: { x: 0, y: 0.04 },
    zBias: { down: 100, side: 100, up: -100 },
  },
  feet: {
    name: "feet",
    bone: "foot.L",
    offset: { x: 0, y: 0 },
    zBias: { down: 1, side: 1, up: 1 },
    replaces: ["foot.L", "foot.R"],
  },
};

export const HUMANOID: SkeletonSpec = {
  id: "unspooler-humanoid",
  version: 1,
  bones: BONES,
  parts: PARTS,
  drawOrder: DRAW_ORDER,
  slots: SLOTS,
  sheetLayout: {
    cols: 4,
    rows: 3,
    order: [
      "head",
      "torso",
      "arm.L",
      "arm.R",
      "hand.L",
      "hand.R",
      "leg.L",
      "leg.R",
      "foot.L",
      "foot.R",
    ],
  },
};

export function boneByName(skeleton: SkeletonSpec, name: BoneName): BoneSpec {
  const bone = skeleton.bones.find((b) => b.name === name);
  if (!bone) throw new Error(`Unknown bone "${name}" in skeleton ${skeleton.id}`);
  return bone;
}

export function partByName(skeleton: SkeletonSpec, name: PartName) {
  const part = skeleton.parts.find((p) => p.name === name);
  if (!part) throw new Error(`Unknown part "${name}" in skeleton ${skeleton.id}`);
  return part;
}

export function partZ(skeleton: SkeletonSpec, facing: Facing, part: PartName): number {
  const i = skeleton.drawOrder[facing].indexOf(part);
  return i < 0 ? 0 : i;
}

/**
 * Map an 8-way direction to the facing that was actually drawn plus whether
 * to mirror it. Side art is authored facing left.
 */
export function facingFor(direction: Direction): { facing: Facing; flipX: boolean } {
  switch (direction) {
    case "up":
      return { facing: "up", flipX: false };
    case "down":
      return { facing: "down", flipX: false };
    case "left":
    case "down-left":
    case "up-left":
      return { facing: "side", flipX: false };
    case "right":
    case "down-right":
    case "up-right":
      return { facing: "side", flipX: true };
    default:
      return { facing: "down", flipX: false };
  }
}

/** Facings that need generated art for a given direction count. */
export function facingsFor(directions: 1 | 4 | 8): Facing[] {
  return directions === 1 ? ["down"] : ["down", "side", "up"];
}
