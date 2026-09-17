/**
 * True multi-event combo: fire a replacement note when a set of triggers
 * (held notes and/or CC threshold crossings) are all active within `windowMs`
 * of each other. Optional `suppressTriggers` holds the individual trigger
 * note-ons back so only the combo note is heard.
 *
 * Latency: only the `windowMs` applies, and only to note-ons that are part of a
 * combo while `suppressTriggers` is on. Everything else is passed through
 * immediately. The hi-hat case does **not** need this - `keyboardMapper` with a
 * CC-conditioned layer samples the pedal at note-on time with zero latency -
 * but `combo` covers real chord-to-note mappings.
 */
import type { RouteContext, Transform } from "../context.js";
import type { ComboTrigger, MidiEvent, TransformConfig } from "../types.js";
import { clamp7 } from "../event.js";
import { applyVelocity } from "../velocity.js";

type Cfg = Extract<TransformConfig, { type: "combo" }>;

const noteKey = (channel: number, note: number) => `${channel}:${note}`;

export function createCombo(cfg: Cfg): Transform {
  /** triggerId -> time it last became satisfied. */
  const satisfied = new Map<string, number>();
  /** held-back note-ons (suppress mode), in arrival order. */
  const pending: { key: string; triggerId: string; ev: MidiEvent }[] = [];
  /** note keys consumed by a completed combo; their note-offs are swallowed. */
  const swallowed = new Map<string, string>(); // key -> triggerId

  let comboActive = false;
  let outNote = 60;
  let outChannel = 0;
  let lastTriggerVelocity = 100;
  let lastTriggerNote = 60;
  let lastTriggerChannel = 0;

  const noteTriggerFor = (channel: number, note: number): ComboTrigger | undefined =>
    cfg.triggers.find(
      (tr) => tr.kind === "note" && tr.value === note && (tr.channel === undefined || tr.channel === channel),
    );

  const ccTriggersFor = (channel: number, controller: number): ComboTrigger[] =>
    cfg.triggers.filter(
      (tr) =>
        (tr.kind === "ccAbove" || tr.kind === "ccBelow") &&
        tr.value === controller &&
        (tr.channel === undefined || tr.channel === channel),
    );

  const comboNoteOn = (now: number): MidiEvent => {
    outChannel = cfg.output.channel ?? lastTriggerChannel;
    outNote = clamp7(cfg.output.note ?? lastTriggerNote + (cfg.output.transpose ?? 0));
    const velocity = Math.max(1, applyVelocity(cfg.output.velocity, lastTriggerVelocity));
    return { t: now, sourceId: "", kind: "noteOn", channel: outChannel, note: outNote, velocity };
  };
  const comboNoteOff = (now: number): MidiEvent => ({
    t: now,
    sourceId: "",
    kind: "noteOff",
    channel: outChannel,
    note: outNote,
    velocity: 0,
  });

  const allSatisfiedWithinWindow = (): boolean => {
    if (satisfied.size < cfg.triggers.length) return false;
    const times = [...satisfied.values()];
    return Math.max(...times) - Math.min(...times) <= cfg.windowMs;
  };

  const evaluate = (now: number): MidiEvent[] => {
    if (comboActive) return [];
    if (!allSatisfiedWithinWindow()) return [];
    comboActive = true;
    // Consume any held-back trigger note-ons.
    for (const p of pending.splice(0)) swallowed.set(p.key, p.triggerId);
    return [comboNoteOn(now)];
  };

  const endCombo = (now: number): MidiEvent[] => {
    if (!comboActive) return [];
    comboActive = false;
    return [comboNoteOff(now)];
  };

  return {
    id: cfg.id,
    type: cfg.type,

    process(ev: MidiEvent, _ctx: RouteContext): MidiEvent[] {
      switch (ev.kind) {
        case "cc": {
          const triggers = ccTriggersFor(ev.channel, ev.controller);
          if (triggers.length === 0) return [ev];
          for (const tr of triggers) {
            const on = tr.kind === "ccAbove" ? ev.value >= (tr.threshold ?? 64) : ev.value <= (tr.threshold ?? 64);
            if (on && !satisfied.has(tr.id)) satisfied.set(tr.id, ev.t);
            else if (!on && satisfied.has(tr.id)) satisfied.delete(tr.id);
          }
          const emitted = evaluate(ev.t);
          const ended = satisfied.size < cfg.triggers.length ? endCombo(ev.t) : [];
          return [...emitted, ...ended, ev];
        }

        case "noteOn": {
          const tr = noteTriggerFor(ev.channel, ev.note);
          if (!tr) return [ev];
          lastTriggerVelocity = ev.velocity;
          lastTriggerNote = ev.note;
          lastTriggerChannel = ev.channel;
          satisfied.set(tr.id, ev.t);
          const out: MidiEvent[] = [];
          if (cfg.suppressTriggers) {
            pending.push({ key: noteKey(ev.channel, ev.note), triggerId: tr.id, ev });
          } else {
            out.push(ev);
          }
          out.push(...evaluate(ev.t));
          return out;
        }

        case "noteOff": {
          const tr = noteTriggerFor(ev.channel, ev.note);
          if (!tr) return [ev];
          const key = noteKey(ev.channel, ev.note);
          satisfied.delete(tr.id);

          if (swallowed.has(key)) {
            swallowed.delete(key);
            return endCombo(ev.t); // note-on was consumed by the combo; swallow this off too
          }
          const pendingIdx = pending.findIndex((p) => p.key === key);
          if (pendingIdx >= 0) {
            // Combo never completed: release the held-back note-on now, then its off.
            const held = pending.splice(pendingIdx, 1)[0]!;
            return [held.ev, ev];
          }
          return [ev, ...endCombo(ev.t)];
        }

        default:
          return [ev];
      }
    },

    tick(now: number): MidiEvent[] {
      if (pending.length === 0) return [];
      const flushed: MidiEvent[] = [];
      for (let i = pending.length - 1; i >= 0; i--) {
        if (now - pending[i]!.ev.t >= cfg.windowMs) {
          flushed.unshift(pending[i]!.ev);
          pending.splice(i, 1);
        }
      }
      return flushed;
    },

    flush(ctx: RouteContext): MidiEvent[] {
      const out = endCombo(ctx.now);
      pending.length = 0;
      swallowed.clear();
      satisfied.clear();
      return out;
    },
  };
}
