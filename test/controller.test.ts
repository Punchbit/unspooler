import { describe, expect, it } from "vitest";
import { bindKeys, CharacterController, directionFromVector } from "../src/controller/index.js";

describe("controller", () => {
  it("maps axes to four-way facing", () => {
    expect(directionFromVector(-1, 0)).toBe("left");
    expect(directionFromVector(0, 1)).toBe("down");
    expect(directionFromVector(-1, 1, true)).toBe("down-left");
  });

  it("idles without input and walks with WASD", () => {
    const c = new CharacterController();
    expect(c.update({ ax: 0, ay: 0 }, 16).state).toBe("idle");
    const walked = c.update({ ax: 0.5, ay: 0 }, 16);
    expect(walked.state).toBe("walk");
    expect(walked.direction).toBe("right");
    expect(walked.x).toBeGreaterThan(0);
  });

  it("locks during attack", () => {
    const c = new CharacterController();
    c.update({ ax: 0, ay: 0, attack: true }, 16);
    expect(c.state).toBe("attack");
    const mid = c.update({ ax: 1, ay: 0 }, 16);
    expect(mid.state).toBe("attack");
  });

  it("reads key sets", () => {
    const input = bindKeys(new Set(["w", "a"]));
    expect(input.ax).toBe(-1);
    expect(input.ay).toBe(-1);
  });
});
