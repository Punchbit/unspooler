import { describe, expect, it } from "vitest";
import { CORE_CLIPS, CORE_CLIP_NAMES } from "../src/rig/animations/index.js";
import { clipPhase, samplePose, sampleScalar } from "../src/rig/pose.js";
import { HUMANOID, facingFor, partZ } from "../src/rig/skeleton.js";
import { RigPlayer } from "../src/rig/player.js";
import type { EquipmentManifest, RigManifest } from "../src/rig/types.js";

describe("humanoid skeleton", () => {
  it("declares every bone after its parent", () => {
    const seen = new Set<string>();
    for (const bone of HUMANOID.bones) {
      if (bone.parent) expect(seen.has(bone.parent)).toBe(true);
      seen.add(bone.name);
    }
  });

  it("binds every part to a real bone", () => {
    const bones = new Set(HUMANOID.bones.map((b) => b.name));
    for (const part of HUMANOID.parts) expect(bones.has(part.bone)).toBe(true);
  });

  it("draws every part exactly once per facing", () => {
    const partNames = HUMANOID.parts.map((p) => p.name).sort();
    for (const facing of ["down", "side", "up"] as const) {
      expect([...HUMANOID.drawOrder[facing]].sort()).toEqual(partNames);
    }
  });

  it("lays out every part exactly once on the sheet grid", () => {
    const partNames = HUMANOID.parts.map((p) => p.name).sort();
    expect([...HUMANOID.sheetLayout.order].sort()).toEqual(partNames);
    expect(HUMANOID.sheetLayout.order.length).toBeLessThanOrEqual(
      HUMANOID.sheetLayout.cols * HUMANOID.sheetLayout.rows,
    );
  });

  it("maps directions to facings with side mirroring", () => {
    expect(facingFor("down")).toEqual({ facing: "down", flipX: false });
    expect(facingFor("left")).toEqual({ facing: "side", flipX: false });
    expect(facingFor("right")).toEqual({ facing: "side", flipX: true });
    expect(facingFor("up-right")).toEqual({ facing: "side", flipX: true });
  });
});

describe("pose sampling", () => {
  it("rest pose puts feet near the origin and head near -1", () => {
    const pose = samplePose(HUMANOID, null, 0);
    const foot = pose.get("foot.L")!;
    expect(foot.y).toBeCloseTo(-0.04, 2);
    const head = pose.get("head")!;
    expect(head.y).toBeCloseTo(-0.86, 2);
    expect(pose.get("root")!.x).toBe(0);
  });

  it("walk swings the legs in opposite phase", () => {
    const clip = CORE_CLIPS.walk!;
    const pose = samplePose(HUMANOID, clip, 0);
    const legL = pose.get("leg.L")!;
    const legR = pose.get("leg.R")!;
    expect(legL.rotation).toBeGreaterThan(0);
    expect(legR.rotation).toBeLessThan(0);
    expect(legL.rotation).toBeCloseTo(-legR.rotation, 5);
    // Feet follow the swing: opposite x displacement.
    const footL = pose.get("foot.L")!;
    const footR = pose.get("foot.R")!;
    expect(Math.sign(footL.x + 0.07)).not.toBe(Math.sign(footR.x - 0.07));
  });

  it("wraps looping tracks across the cycle boundary", () => {
    const frames = [
      { t: 0.25, value: 1 },
      { t: 0.75, value: -1 },
    ];
    // At t=0, halfway between the wrap (0.75 -> 1.25): value 0.
    expect(sampleScalar(frames, 0, true)).toBeCloseTo(0, 5);
    expect(sampleScalar(frames, 0, false)).toBe(1);
  });

  it("clamps one-shot clips and loops cyclic ones", () => {
    expect(clipPhase(CORE_CLIPS.attack!, CORE_CLIPS.attack!.durationMs * 2)).toBe(1);
    expect(clipPhase(CORE_CLIPS.walk!, CORE_CLIPS.walk!.durationMs * 1.5)).toBeCloseTo(0.5, 5);
  });

  it("ships the full core library", () => {
    expect(CORE_CLIP_NAMES.sort()).toEqual(
      ["attack", "death", "hurt", "idle", "jump", "run", "walk"].sort(),
    );
  });
});

function fakeRig(): RigManifest {
  const facings: RigManifest["facings"] = {};
  for (const facing of ["down", "side", "up"] as const) {
    const parts: NonNullable<RigManifest["facings"]["down"]>["parts"] = {};
    for (const part of HUMANOID.parts) {
      parts[part.name] = {
        frame: { x: 0, y: 0, w: 20, h: 40 },
        pivot: { x: 10, y: 4 },
      };
    }
    facings[facing] = { parts };
  }
  return {
    app: "unspooler",
    kind: "rig",
    version: "0.1.0",
    assetId: "hero",
    skeleton: { id: HUMANOID.id, version: HUMANOID.version },
    atlas: "hero.rig.png",
    atlasSize: { w: 256, h: 256 },
    pixelHeight: 200,
    facings,
    animations: ["idle", "walk", "attack"],
    fps: 12,
  };
}

const sword: EquipmentManifest = {
  app: "unspooler",
  kind: "equipment",
  version: "0.1.0",
  assetId: "sword",
  slot: "hand.main",
  mode: "overlay",
  atlas: "sword.equip.png",
  atlasSize: { w: 64, h: 64 },
  pixelHeight: 200,
  facings: { down: { frame: { x: 0, y: 0, w: 10, h: 50 }, pivot: { x: 5, y: 42 } } },
};

const boots: EquipmentManifest = {
  ...sword,
  assetId: "boots",
  slot: "feet",
  mode: "replace",
  atlas: "boots.equip.png",
};

describe("rig player", () => {
  it("emits all parts back-to-front", () => {
    const player = new RigPlayer(fakeRig());
    const list = player.drawList("idle", 0, "down");
    expect(list).toHaveLength(HUMANOID.parts.length);
    for (let i = 1; i < list.length; i++) expect(list[i]!.z).toBeGreaterThanOrEqual(list[i - 1]!.z);
    expect(list[list.length - 1]!.id).toBe("head");
  });

  it("puts an equipped sword in front when facing down and behind when facing up", () => {
    const player = new RigPlayer(fakeRig());
    player.equip(sword);
    const down = player.drawList("idle", 0, "down");
    expect(down[down.length - 1]!.id).toBe("sword");
    const up = player.drawList("idle", 0, "up");
    expect(up[0]!.id).toBe("sword");
  });

  it("follows the hand bone during an attack swing", () => {
    const player = new RigPlayer(fakeRig());
    player.equip(sword);
    const windup = player
      .drawList("attack", CORE_CLIPS.attack!.durationMs * 0.25, "down")
      .find((c) => c.id === "sword")!;
    const swing = player
      .drawList("attack", CORE_CLIPS.attack!.durationMs * 0.45, "down")
      .find((c) => c.id === "sword")!;
    // The arm sweeps ~225° between keyframes, so the sword must rotate with it.
    expect(Math.abs(swing.rotation - windup.rotation)).toBeGreaterThan(1);
  });

  it("hides replaced parts and draws the replacement at both feet", () => {
    const player = new RigPlayer(fakeRig());
    player.equip(boots);
    const list = player.drawList("idle", 0, "down");
    expect(list.filter((c) => c.id === "foot.L" || c.id === "foot.R")).toHaveLength(0);
    expect(list.filter((c) => c.id === "boots")).toHaveLength(2);
    player.unequip("feet");
    expect(player.drawList("idle", 0, "down").some((c) => c.id === "foot.L")).toBe(true);
  });

  it("mirrors right-facing draws", () => {
    const player = new RigPlayer(fakeRig());
    const left = player.drawList("idle", 0, "left").find((c) => c.id === "hand.L")!;
    const right = player.drawList("idle", 0, "right").find((c) => c.id === "hand.L")!;
    expect(right.flipX).toBe(true);
    expect(right.x).toBeCloseTo(-left.x, 5);
    expect(partZ(HUMANOID, "side", "hand.L")).toBe(HUMANOID.drawOrder.side.indexOf("hand.L"));
  });

  it("falls back to the down facing when side art is missing", () => {
    const rig = fakeRig();
    delete rig.facings.side;
    const player = new RigPlayer(rig);
    expect(player.drawList("idle", 0, "left").length).toBeGreaterThan(0);
  });
});
