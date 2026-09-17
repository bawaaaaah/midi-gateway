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
  // Remember the on/off state per (rule, channel) for CC -> note rules so we
  // only send a note-off after a note-on and never repeat.
  const noteHeld = new Map<string, boolean>();

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
    const isOn = noteHeld.get(stateKey) ?? false;
    if (shouldBeOn === isOn) return [];
    noteHeld.set(stateKey, shouldBeOn);
    return [
      shouldBeOn
        ? { t: ev.t, sourceId: ev.sourceId, kind: "noteOn", channel, note: to.note, velocity: clamp7(ev.value) || 100 }
        : { t: ev.t, sourceId: ev.sourceId, kind: "noteOff", channel, note: to.note, velocity: 0 },
    ];
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
    flush(): MidiEvent[] {
      const offs: MidiEvent[] = [];
      for (const [key, held] of noteHeld) {
        if (!held) continue;
        const channel = Number(key.split(":")[1]);
        const rule = cfg.rules.find((r) => r.id === key.split(":")[0]);
        if (rule && rule.to.kind === "note") {
          offs.push({ t: 0, sourceId: "", kind: "noteOff", channel, note: rule.to.note, velocity: 0 });
        }
        noteHeld.set(key, false);
      }
      return offs;
    },
  };
}
