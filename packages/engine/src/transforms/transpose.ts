import type { Transform } from "../context.js";
import type { MidiEvent, TransformConfig } from "../types.js";

type Cfg = Extract<TransformConfig, { type: "transpose" }>;

/**
 * Shift note (and poly-aftertouch) numbers by a fixed number of semitones.
 * Notes that fall outside 0..127 are dropped, unless `wrap` folds them back
 * into range by octaves. The shift is deterministic per input note, so
 * note-on/note-off stay paired for a stable config.
 */
export function createTranspose(cfg: Cfg): Transform {
  const shift = Math.round(cfg.semitones);

  const move = (n: number): number | null => {
    let v = n + shift;
    if (cfg.wrap) {
      while (v < 0) v += 12;
      while (v > 127) v -= 12;
    }
    return v >= 0 && v <= 127 ? v : null;
  };

  return {
    id: cfg.id,
    type: cfg.type,
    process(ev: MidiEvent): MidiEvent[] {
      if (ev.kind === "noteOn" || ev.kind === "noteOff") {
        const n = move(ev.note);
        return n === null ? [] : [{ ...ev, note: n }];
      }
      if (ev.kind === "aftertouch" && ev.note !== undefined) {
        const n = move(ev.note);
        return n === null ? [] : [{ ...ev, note: n }];
      }
      return [ev];
    },
  };
}
