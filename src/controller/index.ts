import type { Direction, SpriteManifest } from "../types.js";
import { framesFor } from "../manifest.js";
import { RigPlayer } from "../rig/player.js";
import type { DrawCommand, EquipmentManifest, SlotName } from "../rig/types.js";

export const CONTROLLER_STATES = [
  "idle",
  "walk",
  "run",
  "attack",
  "hurt",
  "jump",
  "death",
] as const;

export type ControllerState = (typeof CONTROLLER_STATES)[number];

export interface ControllerInput {
  ax: number;
  ay: number;
  attack?: boolean;
  jump?: boolean;
}

export interface ControllerConfig {
  walkSpeed?: number;
  runSpeed?: number;
  runThreshold?: number;
  attackMs?: number;
  jumpMs?: number;
  hurtMs?: number;
}

export interface ControllerSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  state: ControllerState;
  direction: Direction;
  animation: string;
  grounded: boolean;
}

const DIR_FROM_VECTOR: Array<{ dir: Direction; x: number; y: number }> = [
  { dir: "down", x: 0, y: 1 },
  { dir: "down-left", x: -1, y: 1 },
  { dir: "left", x: -1, y: 0 },
  { dir: "up-left", x: -1, y: -1 },
  { dir: "up", x: 0, y: -1 },
  { dir: "up-right", x: 1, y: -1 },
  { dir: "right", x: 1, y: 0 },
  { dir: "down-right", x: 1, y: 1 },
];

export function directionFromVector(ax: number, ay: number, allow8 = false): Direction | null {
  if (ax === 0 && ay === 0) return null;
  if (!allow8) {
    if (Math.abs(ax) > Math.abs(ay)) return ax < 0 ? "left" : "right";
    return ay < 0 ? "up" : "down";
  }
  const nx = Math.sign(Math.round(ax));
  const ny = Math.sign(Math.round(ay));
  return DIR_FROM_VECTOR.find((d) => d.x === nx && d.y === ny)?.dir ?? "down";
}

/**
 * Headless character controller. Bind it to an unspooler manifest and feed
 * WASD / gamepad axes each tick. This is the seed of a future standalone package.
 */
export class CharacterController {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  state: ControllerState = "idle";
  direction: Direction = "down";
  grounded = true;
  private lockUntil = 0;
  private time = 0;
  private rig?: RigPlayer;
  /** Time since the current animation state began, for rig clip playback. */
  private stateTime = 0;

  constructor(
    readonly manifest?: SpriteManifest,
    readonly config: ControllerConfig = {},
  ) {}

  /** Drive a skeletal rig instead of (or alongside) a baked sheet. */
  attachRig(player: RigPlayer): void {
    this.rig = player;
  }

  getRig(): RigPlayer | undefined {
    return this.rig;
  }

  /** Deterministic equipment: sprite follows the slot's bone, no detection. */
  equip(item: EquipmentManifest): void {
    if (!this.rig) throw new Error("No rig attached. Call attachRig(player) first.");
    this.rig.equip(item);
  }

  unequip(slot: SlotName): void {
    this.rig?.unequip(slot);
  }

  equipped(): EquipmentManifest[] {
    return this.rig?.equipped() ?? [];
  }

  /** Back-to-front draw commands for the current state, from the attached rig. */
  drawList(scale = 1): DrawCommand[] {
    if (!this.rig) return [];
    return this.rig.drawList(this.state, this.stateTime, this.direction, { scale });
  }

  get walkSpeed(): number {
    return this.config.walkSpeed ?? 80;
  }
  get runSpeed(): number {
    return this.config.runSpeed ?? 140;
  }
  get runThreshold(): number {
    return this.config.runThreshold ?? 0.85;
  }

  update(input: ControllerInput, dtMs: number): ControllerSnapshot {
    const stateBefore = this.state;
    const snap = this.step(input, dtMs);
    this.stateTime = this.state === stateBefore ? this.stateTime + dtMs : 0;
    return snap;
  }

  private step(input: ControllerInput, dtMs: number): ControllerSnapshot {
    this.time += dtMs;
    const allow8 = Boolean(
      this.manifest?.meta.frameTags.some((t) => t.name.includes("down-left")),
    );

    if (this.state === "death") {
      return this.snapshot();
    }

    if (this.time < this.lockUntil) {
      this.x += this.vx * (dtMs / 1000);
      this.y += this.vy * (dtMs / 1000);
      return this.snapshot();
    }

    if (input.attack && this.hasAnim("attack")) {
      this.state = "attack";
      this.vx = 0;
      this.vy = 0;
      this.lockUntil = this.time + (this.config.attackMs ?? 350);
      return this.snapshot();
    }
    if (input.jump && this.hasAnim("jump") && this.grounded) {
      this.state = "jump";
      this.lockUntil = this.time + (this.config.jumpMs ?? 400);
      return this.snapshot();
    }

    const mag = Math.hypot(input.ax, input.ay);
    const facing = directionFromVector(input.ax, input.ay, allow8);
    if (facing) this.direction = facing;

    if (mag < 0.08) {
      this.vx = 0;
      this.vy = 0;
      this.state = "idle";
    } else {
      const speed = mag >= this.runThreshold && this.hasAnim("run") ? this.runSpeed : this.walkSpeed;
      const nx = input.ax / mag;
      const ny = input.ay / mag;
      this.vx = nx * speed;
      this.vy = ny * speed;
      this.state = speed === this.runSpeed ? "run" : "walk";
    }

    this.x += this.vx * (dtMs / 1000);
    this.y += this.vy * (dtMs / 1000);
    return this.snapshot();
  }

  currentFrames() {
    if (!this.manifest) return [];
    const exact = framesFor(this.manifest, this.state, this.direction);
    if (exact.length) return exact;
    return framesFor(this.manifest, this.state) || framesFor(this.manifest, "idle", this.direction);
  }

  private hasAnim(name: string): boolean {
    if (this.rig) return this.rig.hasAnimation(name);
    if (!this.manifest) return true;
    return this.manifest.meta.frameTags.some(
      (t) => t.name === name || t.name.startsWith(`${name}-`),
    );
  }

  snapshot(): ControllerSnapshot {
    return {
      x: this.x,
      y: this.y,
      vx: this.vx,
      vy: this.vy,
      state: this.state,
      direction: this.direction,
      animation: this.state,
      grounded: this.grounded,
    };
  }
}

// Rig runtime re-exports: the controller entry is the dependency-free
// runtime bundle, so the Studio and game code can import everything from it.
export { RigPlayer } from "../rig/player.js";
export { HUMANOID, facingFor, partZ } from "../rig/skeleton.js";
export { CORE_CLIPS, CORE_CLIP_NAMES, getClip } from "../rig/animations/index.js";
export { samplePose } from "../rig/pose.js";
export type {
  AnimationClip,
  DrawCommand,
  EquipmentManifest,
  Facing,
  PartName,
  RigManifest,
  SkeletonSpec,
  SlotName,
} from "../rig/types.js";

export function bindKeys(held: Set<string>): ControllerInput {
  let ax = 0;
  let ay = 0;
  if (held.has("arrowleft") || held.has("a")) ax -= 1;
  if (held.has("arrowright") || held.has("d")) ax += 1;
  if (held.has("arrowup") || held.has("w")) ay -= 1;
  if (held.has("arrowdown") || held.has("s")) ay += 1;
  return {
    ax,
    ay,
    attack: held.has(" ") || held.has("j"),
    jump: held.has("k") || held.has("shift"),
  };
}
