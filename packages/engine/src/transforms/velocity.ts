import type { Transform } from "../context.js";
import type { MidiEvent, TransformConfig } from "../types.js";
import { applyVelocity } from "../velocity.js";

type Cfg = Extract<TransformConfig, { type: "velocity" }>;

/** Reshape note-on velocity (curve / scale / fixed). Note-offs pass untouched. */
export function createVelocity(cfg: Cfg): Transform {
  const channels = cfg.channels && cfg.channels.length ? new Set(cfg.channels) : null;

  return {
    id: cfg.id,
    type: cfg.type,
    process(ev: MidiEvent): MidiEvent[] {
      if (ev.kind !== "noteOn") return [ev];
      if (channels && !channels.has(ev.channel)) return [ev];
      const velocity = applyVelocity(cfg.spec, ev.velocity);
      // A curve must never turn an audible hit into a note-off (velocity 0).
      return [{ ...ev, velocity: Math.max(1, velocity) }];
    },
  };
}
