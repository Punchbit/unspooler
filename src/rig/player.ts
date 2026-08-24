import type { Direction } from "../types.js";
import { CORE_CLIPS, getClip } from "./animations/index.js";
import { samplePose } from "./pose.js";
import { HUMANOID, facingFor, partZ } from "./skeleton.js";
import type {
  AnimationClip,
  DrawCommand,
  EquipmentManifest,
  Facing,
  PartName,
  RigManifest,
  SkeletonSpec,
  SlotName,
} from "./types.js";

export interface RigPlayerOptions {
  skeleton?: SkeletonSpec;
  /** Extra clips on top of the core library (same skeleton). */
  clips?: Record<string, AnimationClip>;
}

export interface DrawListOptions {
  /** Output pixels per atlas pixel. Default 1. */
  scale?: number;
}

/**
 * Dependency-free bone runtime. Evaluates a clip at a time, walks the
 * skeleton, and returns a back-to-front draw list. Every renderer — the
 * local bake, the Studio playground, the CSS/Phaser outputs — consumes this.
 *
 * Equipment is deterministic: `equip()` inserts commands at the slot's bone
 * with the skeleton's per-facing z-order. No detection involved.
 */
export class RigPlayer {
  readonly skeleton: SkeletonSpec;
  private readonly clips: Record<string, AnimationClip>;
  private readonly items = new Map<SlotName, EquipmentManifest>();

  constructor(
    readonly rig: RigManifest,
    options: RigPlayerOptions = {},
  ) {
    this.skeleton = options.skeleton ?? HUMANOID;
    this.clips = { ...CORE_CLIPS, ...(options.clips ?? {}) };
  }

  animations(): string[] {
    return this.rig.animations.filter((name) => Boolean(getClip(name, this.clips)));
  }

  hasAnimation(name: string): boolean {
    return Boolean(getClip(name, this.clips));
  }

  clipDuration(name: string): number {
    return getClip(name, this.clips)?.durationMs ?? 0;
  }

  equip(item: EquipmentManifest): void {
    if (!this.skeleton.slots[item.slot]) {
      throw new Error(`Unknown slot "${item.slot}" on skeleton ${this.skeleton.id}`);
    }
    this.items.set(item.slot, item);
  }

  unequip(slot: SlotName): void {
    this.items.delete(slot);
  }

  equipped(): EquipmentManifest[] {
    return [...this.items.values()];
  }

  /**
   * Back-to-front draw commands for one moment of one animation, facing one
   * direction. Positions are pixels relative to the feet-center origin.
   */
  drawList(animation: string, timeMs: number, direction: Direction, options: DrawListOptions = {}): DrawCommand[] {
    const scale = options.scale ?? 1;
    const { facing: wanted, flipX } = facingFor(direction);
    const facing = this.resolveFacing(wanted);
    const clip = getClip(animation, this.clips);
    const pose = samplePose(this.skeleton, clip, timeMs);
    const unitsToPx = this.rig.pixelHeight;

    const hidden = new Set<PartName>();
    for (const item of this.items.values()) {
      if (item.mode !== "replace") continue;
      const replaces = item.replaces ?? this.skeleton.slots[item.slot].replaces ?? [];
      for (const part of replaces) hidden.add(part);
    }

    const commands: DrawCommand[] = [];

    const facingArt = this.rig.facings[facing];
    for (const part of this.skeleton.drawOrder[facing]) {
      if (hidden.has(part)) continue;
      const art = facingArt?.parts[part];
      if (!art) continue;
      const spec = this.skeleton.parts.find((p) => p.name === part)!;
      const wt = pose.get(spec.bone);
      if (!wt) continue;
      commands.push(
        this.command({
          kind: "part",
          id: part,
          frame: art.frame,
          pivot: art.pivot,
          x: wt.x * unitsToPx,
          y: wt.y * unitsToPx,
          rotation: wt.rotation,
          z: partZ(this.skeleton, facing, part),
          scale,
          flipX,
        }),
      );
    }

    for (const item of this.items.values()) {
      const slot = this.skeleton.slots[item.slot];
      const art = item.facings[facing] ?? item.facings.down ?? Object.values(item.facings)[0];
      if (!art) continue;
      const itemScale = scale * (this.rig.pixelHeight / (item.pixelHeight || this.rig.pixelHeight));

      const targets =
        item.mode === "replace"
          ? (item.replaces ?? slot.replaces ?? []).map((part) => ({
              bone: this.skeleton.parts.find((p) => p.name === part)!.bone,
              z: partZ(this.skeleton, facing, part) + 0.5,
            }))
          : [{ bone: slot.bone, z: this.baseZFor(slot.bone, facing) + slot.zBias[facing] }];

      for (const target of targets) {
        const wt = pose.get(target.bone);
        if (!wt) continue;
        const grip = item.gripOffset ?? { x: 0, y: 0 };
        const off = item.mode === "replace" ? grip : {
          x: slot.offset.x + grip.x,
          y: slot.offset.y + grip.y,
        };
        const cos = Math.cos(wt.rotation);
        const sin = Math.sin(wt.rotation);
        commands.push(
          this.command({
            kind: "equipment",
            id: item.assetId,
            frame: art.frame,
            pivot: art.pivot,
            atlas: item.atlas,
            x: (wt.x + off.x * cos - off.y * sin) * unitsToPx,
            y: (wt.y + off.x * sin + off.y * cos) * unitsToPx,
            rotation: wt.rotation + (item.rotation ?? 0),
            z: target.z,
            scale: itemScale,
            flipX,
          }),
        );
      }
    }

    return commands.sort((a, b) => a.z - b.z);
  }

  /** Fall back gracefully when a facing was never generated. */
  private resolveFacing(facing: Facing): Facing {
    if (this.rig.facings[facing]) return facing;
    if (this.rig.facings.down) return "down";
    return (Object.keys(this.rig.facings)[0] as Facing) ?? "down";
  }

  private baseZFor(bone: string, facing: Facing): number {
    const part = this.skeleton.parts.find((p) => p.bone === bone);
    return part ? partZ(this.skeleton, facing, part.name) : this.skeleton.drawOrder[facing].length;
  }

  /** Bake the horizontal mirror into the command so renderers stay simple. */
  private command(cmd: Omit<DrawCommand, "x" | "y" | "rotation" | "pivot" | "flipX"> & {
    x: number;
    y: number;
    rotation: number;
    pivot: { x: number; y: number };
    flipX: boolean;
  }): DrawCommand {
    if (!cmd.flipX) return { ...cmd };
    return {
      ...cmd,
      x: -cmd.x,
      rotation: -cmd.rotation,
      pivot: { x: cmd.frame.w - cmd.pivot.x, y: cmd.pivot.y },
    };
  }
}
