import type { AnimationClip, Keyframe, Vec2Keyframe } from "../types.js";

/**
 * The core animation library for the unspooler humanoid skeleton, v1.
 * Hand-authored keyframes; times are normalized [0, 1] per cycle.
 *
 * These are deliberately readable data, not code — tweak numbers freely.
 * Positive rotation is clockwise in screen space; limbs rest pointing down.
 */

const deg = (d: number): number => (d * Math.PI) / 180;

function rot(...pairs: Array<[number, number]>): Keyframe[] {
  return pairs.map(([t, d]) => ({ t, value: deg(d) }));
}

function pos(...pairs: Array<[number, number, number]>): Vec2Keyframe[] {
  return pairs.map(([t, x, y]) => ({ t, value: { x, y } }));
}

/** Opposite-phase copy of a rotation track (for the other arm/leg). */
function counter(frames: Keyframe[]): Keyframe[] {
  return frames.map((f) => ({ t: f.t, value: -f.value }));
}

const IDLE: AnimationClip = {
  name: "idle",
  durationMs: 2000,
  loop: true,
  tracks: {
    hips: { position: pos([0, 0, 0], [0.5, 0, 0.008], [1, 0, 0]) },
    torso: { rotation: rot([0, 0], [0.5, 1.2], [1, 0]) },
    head: { rotation: rot([0, 0], [0.5, -1.2], [1, 0]) },
    "arm.L": { rotation: rot([0, 2], [0.5, 4], [1, 2]) },
    "arm.R": { rotation: rot([0, -2], [0.5, -4], [1, -2]) },
  },
};

const walkLeg = rot([0, 24], [0.25, 0], [0.5, -24], [0.75, 0], [1, 24]);
const walkArm = rot([0, -18], [0.25, 0], [0.5, 18], [0.75, 0], [1, -18]);
const walkFoot = rot([0, -10], [0.25, 4], [0.5, 12], [0.75, 0], [1, -10]);

const WALK: AnimationClip = {
  name: "walk",
  durationMs: 800,
  loop: true,
  tracks: {
    hips: { position: pos([0, 0, 0], [0.25, 0, -0.015], [0.5, 0, 0], [0.75, 0, -0.015], [1, 0, 0]) },
    torso: { rotation: rot([0, 1.5], [0.5, -1.5], [1, 1.5]) },
    "leg.L": { rotation: walkLeg },
    "leg.R": { rotation: counter(walkLeg) },
    "foot.L": { rotation: walkFoot },
    "foot.R": { rotation: counter(walkFoot) },
    "arm.L": { rotation: walkArm },
    "arm.R": { rotation: counter(walkArm) },
    "hand.L": { rotation: rot([0, -6], [0.5, 6], [1, -6]) },
    "hand.R": { rotation: rot([0, 6], [0.5, -6], [1, 6]) },
  },
};

const runLeg = rot([0, 42], [0.25, 0], [0.5, -42], [0.75, 0], [1, 42]);
const runArm = rot([0, -34], [0.25, 0], [0.5, 34], [0.75, 0], [1, -34]);

const RUN: AnimationClip = {
  name: "run",
  durationMs: 520,
  loop: true,
  tracks: {
    hips: {
      position: pos([0, 0, -0.01], [0.25, 0, -0.035], [0.5, 0, -0.01], [0.75, 0, -0.035], [1, 0, -0.01]),
    },
    torso: { rotation: rot([0, 6], [1, 6]) },
    head: { rotation: rot([0, -4], [1, -4]) },
    "leg.L": { rotation: runLeg },
    "leg.R": { rotation: counter(runLeg) },
    "foot.L": { rotation: rot([0, -18], [0.25, 10], [0.5, 22], [0.75, 0], [1, -18]) },
    "foot.R": { rotation: rot([0, 22], [0.25, 0], [0.5, -18], [0.75, 10], [1, 22]) },
    "arm.L": { rotation: runArm },
    "arm.R": { rotation: counter(runArm) },
    "hand.L": { rotation: rot([0, -22], [0.5, 22], [1, -22]) },
    "hand.R": { rotation: rot([0, 22], [0.5, -22], [1, 22]) },
  },
};

const JUMP: AnimationClip = {
  name: "jump",
  durationMs: 700,
  loop: false,
  tracks: {
    hips: {
      position: pos([0, 0, 0], [0.18, 0, 0.07], [0.45, 0, -0.22], [0.75, 0, -0.05], [0.9, 0, 0.03], [1, 0, 0]),
    },
    torso: { rotation: rot([0, 0], [0.18, 8], [0.45, -6], [1, 0]) },
    "leg.L": { rotation: rot([0, 0], [0.18, 28], [0.45, -14], [0.75, 4], [1, 0]) },
    "leg.R": { rotation: rot([0, 0], [0.18, 28], [0.45, -10], [0.75, 4], [1, 0]) },
    "foot.L": { rotation: rot([0, 0], [0.18, -20], [0.45, 24], [1, 0]) },
    "foot.R": { rotation: rot([0, 0], [0.18, -20], [0.45, 24], [1, 0]) },
    "arm.L": { rotation: rot([0, 0], [0.18, 16], [0.45, -60], [0.8, -8], [1, 0]) },
    "arm.R": { rotation: rot([0, 0], [0.18, -16], [0.45, 60], [0.8, 8], [1, 0]) },
  },
};

const ATTACK: AnimationClip = {
  name: "attack",
  durationMs: 450,
  loop: false,
  tracks: {
    torso: { rotation: rot([0, 0], [0.25, -10], [0.5, 14], [0.8, 4], [1, 0]) },
    hips: { position: pos([0, 0, 0], [0.5, 0, 0.01], [1, 0, 0]) },
    // Main (right) arm: wind up back, then swing hard forward.
    "arm.R": { rotation: rot([0, 0], [0.25, -130], [0.45, 95], [0.75, 60], [1, 0]) },
    "hand.R": { rotation: rot([0, 0], [0.25, -30], [0.45, 25], [1, 0]) },
    "arm.L": { rotation: rot([0, 0], [0.25, 24], [0.5, -20], [1, 0]) },
    "leg.L": { rotation: rot([0, 0], [0.5, -8], [1, 0]) },
    "leg.R": { rotation: rot([0, 0], [0.5, 8], [1, 0]) },
    head: { rotation: rot([0, 0], [0.25, 6], [0.5, -6], [1, 0]) },
  },
};

const HURT: AnimationClip = {
  name: "hurt",
  durationMs: 400,
  loop: false,
  tracks: {
    torso: { rotation: rot([0, 0], [0.3, -16], [1, 0]) },
    head: { rotation: rot([0, 0], [0.3, -12], [1, 0]) },
    hips: { position: pos([0, 0, 0], [0.3, -0.02, 0.02], [1, 0, 0]) },
    "arm.L": { rotation: rot([0, 0], [0.3, -24], [1, 0]) },
    "arm.R": { rotation: rot([0, 0], [0.3, 24], [1, 0]) },
  },
};

const DEATH: AnimationClip = {
  name: "death",
  durationMs: 900,
  loop: false,
  tracks: {
    hips: {
      position: pos([0, 0, 0], [0.35, -0.04, 0.1], [0.7, -0.2, 0.34], [1, -0.24, 0.4]),
    },
    torso: { rotation: rot([0, 0], [0.35, -20], [0.7, -70], [1, -84]) },
    head: { rotation: rot([0, 0], [0.5, -20], [1, -10]) },
    "leg.L": { rotation: rot([0, 0], [0.5, 30], [1, 60]) },
    "leg.R": { rotation: rot([0, 0], [0.5, 44], [1, 78]) },
    "arm.L": { rotation: rot([0, 0], [0.5, -40], [1, -70]) },
    "arm.R": { rotation: rot([0, 0], [0.5, 30], [1, 55]) },
  },
};

export const CORE_CLIPS: Record<string, AnimationClip> = {
  idle: IDLE,
  walk: WALK,
  run: RUN,
  jump: JUMP,
  attack: ATTACK,
  hurt: HURT,
  death: DEATH,
};

export const CORE_CLIP_NAMES = Object.keys(CORE_CLIPS);

export function getClip(name: string, extra?: Record<string, AnimationClip>): AnimationClip | null {
  return extra?.[name] ?? CORE_CLIPS[name] ?? null;
}
