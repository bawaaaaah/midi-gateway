import type { RouteContext, Transform } from "../context.js";
import type { MidiEvent, TransformConfig } from "../types.js";

type Cfg = Extract<TransformConfig, { type: "learnTap" }>;

/**
 * Pass-through that feeds the route's learn buffer (when learn mode is on).
 * Place it early in the chain to learn the raw device output, or later to learn
 * what a mapping produces.
 */
export function createLearnTap(cfg: Cfg): Transform {
  return {
    id: cfg.id,
    type: cfg.type,
    process(ev: MidiEvent, ctx: RouteContext): MidiEvent[] {
      ctx.learn?.observe(ev, ctx.cc);
      return [ev];
    },
  };
}
