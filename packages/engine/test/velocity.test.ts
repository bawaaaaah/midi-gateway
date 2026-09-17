import { describe, expect, it } from "vitest";
import { applyVelocity } from "../src/velocity.js";

describe("applyVelocity", () => {
  it("passthrough returns the clamped input", () => {
    expect(applyVelocity({ mode: "passthrough" }, 64)).toBe(64);
    expect(applyVelocity(undefined, 200)).toBe(127);
  });

  it("fixed ignores the input", () => {
    expect(applyVelocity({ mode: "fixed", value: 30 }, 120)).toBe(30);
  });

  it("scale maps 1..127 into [min,max]", () => {
    expect(applyVelocity({ mode: "scale", min: 40, max: 80 }, 1)).toBe(40);
    expect(applyVelocity({ mode: "scale", min: 40, max: 80 }, 127)).toBe(80);
    expect(applyVelocity({ mode: "scale", min: 40, max: 80 }, 64)).toBe(60);
  });

  it("exp curve softens low velocities, log curve lifts them", () => {
    const soft = applyVelocity({ mode: "curve", shape: "exp", amount: 1 }, 64);
    const lift = applyVelocity({ mode: "curve", shape: "log", amount: 1 }, 64);
    expect(soft).toBeLessThan(64);
    expect(lift).toBeGreaterThan(64);
  });

  it("curve keeps the endpoints", () => {
    expect(applyVelocity({ mode: "curve", shape: "sCurve", amount: 1 }, 127)).toBe(127);
    expect(applyVelocity({ mode: "curve", shape: "exp", amount: 1 }, 0)).toBe(0);
  });

  it("points does piecewise-linear interpolation", () => {
    const spec = { mode: "points", points: [[0, 0], [64, 100], [127, 110]] } as const;
    expect(applyVelocity(spec, 0)).toBe(0);
    expect(applyVelocity(spec, 64)).toBe(100);
    expect(applyVelocity(spec, 32)).toBe(50);
  });
});
