/** Apply a {@link VelocitySpec} to an incoming velocity (1..127). */
import type { VelocityCurveShape, VelocitySpec } from "./types.js";
import { clamp7 } from "./event.js";

export function applyVelocity(spec: VelocitySpec | undefined, input: number): number {
  if (!spec || spec.mode === "passthrough") return clamp7(input);

  switch (spec.mode) {
    case "fixed":
      return clamp7(spec.value);
    case "scale": {
      // Map 1..127 linearly into [min, max].
      const t = (clamp7(input) - 1) / 126;
      return clamp7(spec.min + t * (spec.max - spec.min));
    }
    case "curve": {
      const x = clamp7(input) / 127;
      return clamp7(applyCurve(spec.shape, x, spec.amount ?? 0.5) * 127);
    }
    case "points":
      return clamp7(piecewise(spec.points, clamp7(input)));
  }
}

/** `x` in 0..1, `amount` in 0..1 blends linear (0) -> full curve (1). Returns 0..1. */
export function applyCurve(shape: VelocityCurveShape, x: number, amount: number): number {
  const k = Math.max(0, Math.min(1, amount));
  switch (shape) {
    case "linear":
      return x;
    case "exp":
      // Gamma > 1: soft low end, steep high end.
      return Math.pow(x, 1 + 2 * k);
    case "log":
      // Gamma < 1: steep low end, soft high end.
      return Math.pow(x, 1 / (1 + 2 * k));
    case "sCurve": {
      const s = x * x * (3 - 2 * x); // smoothstep
      return x + (s - x) * k;
    }
  }
}

function piecewise(points: [number, number][], x: number): number {
  if (points.length === 0) return x;
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  if (x <= sorted[0]![0]) return sorted[0]![1];
  const last = sorted[sorted.length - 1]!;
  if (x >= last[0]) return last[1];
  for (let i = 0; i < sorted.length - 1; i++) {
    const [x0, y0] = sorted[i]!;
    const [x1, y1] = sorted[i + 1]!;
    if (x >= x0 && x <= x1) {
      const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return x;
}
