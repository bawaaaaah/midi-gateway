import type { Transform } from "../context.js";
import type { FilterMatch, MidiEvent, TransformConfig } from "../types.js";

type Cfg = Extract<TransformConfig, { type: "filter" }>;

function matches(ev: MidiEvent, m: FilterMatch): boolean {
  if (m.kinds && m.kinds.length && !m.kinds.includes(ev.kind)) return false;
  if (m.channels && m.channels.length) {
    if (!("channel" in ev) || !m.channels.includes(ev.channel)) return false;
  }
  if (ev.kind === "noteOn" || ev.kind === "noteOff") {
    if (m.noteMin !== undefined && ev.note < m.noteMin) return false;
    if (m.noteMax !== undefined && ev.note > m.noteMax) return false;
  }
  if (ev.kind === "noteOn") {
    if (m.velocityMin !== undefined && ev.velocity < m.velocityMin) return false;
    if (m.velocityMax !== undefined && ev.velocity > m.velocityMax) return false;
  }
  if (ev.kind === "cc" && m.controllers && m.controllers.length) {
    if (!m.controllers.includes(ev.controller)) return false;
  }
  return true;
}

/**
 * `action: "drop"` removes matching events; `action: "keep"` removes everything
 * that does *not* match (a whitelist). Non-note events that don't carry the
 * matched fields are treated as "not matching".
 */
export function createFilter(cfg: Cfg): Transform {
  return {
    id: cfg.id,
    type: cfg.type,
    process(ev: MidiEvent): MidiEvent[] {
      const hit = matches(ev, cfg.match);
      const pass = cfg.action === "drop" ? !hit : hit;
      return pass ? [ev] : [];
    },
  };
}
