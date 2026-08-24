import { boneByName } from "./skeleton.js";
import type {
  AnimationClip,
  BoneName,
  BoneTrack,
  Keyframe,
  SkeletonSpec,
  Vec2,
  Vec2Keyframe,
} from "./types.js";

export interface WorldTransform {
  /** Bone origin in character units, relative to the feet-center origin. */
  x: number;
  y: number;
  /** Accumulated rotation, radians clockwise. */
  rotation: number;
}

export type Pose = Map<BoneName, WorldTransform>;

/** Normalized clip time in [0, 1) for looping clips, clamped for one-shots. */
export function clipPhase(clip: AnimationClip, timeMs: number): number {
  if (clip.durationMs <= 0) return 0;
  const t = timeMs / clip.durationMs;
  if (clip.loop) return t - Math.floor(t);
  return Math.min(1, Math.max(0, t));
}

export function sampleScalar(frames: Keyframe[] | undefined, t: number, loop: boolean): number {
  if (!frames?.length) return 0;
  return sample(frames, t, loop, (a, b, k) => a + (b - a) * k, (f) => f.value);
}

export function sampleVec2(
  frames: Vec2Keyframe[] | undefined,
  t: number,
  loop: boolean,
): Vec2 {
  if (!frames?.length) return { x: 0, y: 0 };
  return sample(
    frames,
    t,
    loop,
    (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }),
    (f) => f.value,
  );
}

function sample<F extends { t: number }, V>(
  frames: F[],
  t: number,
  loop: boolean,
  lerp: (a: V, b: V, k: number) => V,
  value: (f: F) => V,
): V {
  const first = frames[0]!;
  const last = frames[frames.length - 1]!;
  if (t <= first.t) {
    if (!loop) return value(first);
    // Wrap from the last keyframe around to the first.
    const span = first.t + (1 - last.t);
    if (span <= 0) return value(first);
    return lerp(value(last), value(first), (t + (1 - last.t)) / span);
  }
  if (t >= last.t) {
    if (!loop) return value(last);
    const span = first.t + (1 - last.t);
    if (span <= 0) return value(last);
    return lerp(value(last), value(first), (t - last.t) / span);
  }
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i]!;
    const b = frames[i + 1]!;
    if (t >= a.t && t <= b.t) {
      const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return lerp(value(a), value(b), k);
    }
  }
  return value(last);
}

/**
 * Evaluate a clip at a time and produce world transforms for every bone by
 * walking the hierarchy. Local track offsets stack on top of rest pose.
 */
export function samplePose(
  skeleton: SkeletonSpec,
  clip: AnimationClip | null,
  timeMs: number,
): Pose {
  const phase = clip ? clipPhase(clip, timeMs) : 0;
  const pose: Pose = new Map();

  for (const bone of skeleton.bones) {
    const track: BoneTrack | undefined = clip?.tracks[bone.name];
    const rot = clip ? sampleScalar(track?.rotation, phase, clip.loop) : 0;
    const off = clip ? sampleVec2(track?.position, phase, clip.loop) : { x: 0, y: 0 };
    const localX = bone.position.x + off.x;
    const localY = bone.position.y + off.y;

    if (!bone.parent) {
      pose.set(bone.name, { x: localX, y: localY, rotation: rot });
      continue;
    }
    const parent = pose.get(bone.parent);
    if (!parent) {
      // Bones are declared parents-first; guard for malformed specs.
      const p = boneByName(skeleton, bone.parent);
      throw new Error(`Bone "${bone.name}" declared before its parent "${p.name}"`);
    }
    const cos = Math.cos(parent.rotation);
    const sin = Math.sin(parent.rotation);
    pose.set(bone.name, {
      x: parent.x + localX * cos - localY * sin,
      y: parent.y + localX * sin + localY * cos,
      rotation: parent.rotation + rot,
    });
  }
  return pose;
}
