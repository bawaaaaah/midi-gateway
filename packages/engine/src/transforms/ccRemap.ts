import type { Transform, RouteContext } from "../context.js";
import type { CcRemapRule, MidiEvent, TransformConfig } from "../types.js";
import { clamp7 } from "../event.js";

type Cfg = Extract<TransformConfig, { type: "ccRemap" }>;

/**
 * Rewrite control-change messages: CC -> CC (optionally inverted / rescaled),
 * CC -> note (a foot switch that should play a note), or CC -> drop.
 * A rule with no `fromChannel` matches any channel.
 */
export function createCcRemap(cfg: Cfg): Transform {
  // Notes currently held by CC -> note rules, keyed by (rule, channel), so we
  // only send a note-off after a note-on, never repeat, and can release them on flush.
  const noteHeld = new Map<string, { channel: number; note: number }>();

  const applyRule = (rule: CcRemapRule, ev: Extract<MidiEvent, { kind: "cc" }>): MidiEvent[] => {
    const to = rule.to;
    if (to.kind === "drop") return [];

    if (to.kind === "cc") {
      let value = ev.value;
      if (to.scale) {
        const [lo, hi] = to.scale;
        value = lo + (value / 127) * (hi - lo);
      }
      if (to.invert) value = 127 - value;
      return [{ ...ev, controller: to.controller, channel: to.channel ?? ev.channel, value: clamp7(value) }];
    }

    // to.kind === "note"
    const threshold = to.threshold ?? 64;
    const channel = to.channel ?? ev.channel;
    const stateKey = `${rule.id}:${channel}`;
    const shouldBeOn = ev.value >= threshold;
    const held = noteHeld.get(stateKey);
    if (shouldBeOn === (held !== undefined)) return [];
    if (shouldBeOn) {
      noteHeld.set(stateKey, { channel, note: to.note });
      return [{ t: ev.t, sourceId: ev.sourceId, kind: "noteOn", channel, note: to.note, velocity: clamp7(ev.value) || 100 }];
    }
    noteHeld.delete(stateKey);
    // Release the note that was actually started, even if the rule was edited since.
    return [{ t: ev.t, sourceId: ev.sourceId, kind: "noteOff", channel: held!.channel, note: held!.note, velocity: 0 }];
  };

  return {
    id: cfg.id,
    type: cfg.type,
    process(ev: MidiEvent, _ctx: RouteContext): MidiEvent[] {
      if (ev.kind !== "cc") return [ev];
      const rule = cfg.rules.find(
        (r) => r.fromController === ev.controller && (r.fromChannel === undefined || r.fromChannel === ev.channel),
      );
      if (!rule) return [ev];
      return applyRule(rule, ev);
    },
    flush(ctx: RouteContext): MidiEvent[] {
      const offs: MidiEvent[] = [...noteHeld.values()].map((h) => ({
        t: ctx.now,
        sourceId: "",
        kind: "noteOff" as const,
        channel: h.channel,
        note: h.note,
        velocity: 0,
      }));
      noteHeld.clear();
      return offs;
    },
  };
}
