/**
 * Auto-learn buffer: watches a stream of incoming events and aggregates them by
 * signature so the UI can show "what did this device just send me" and let the
 * user mass-assign outputs.
 *
 * For note hits it also records which CCs were active at the moment of the hit
 * (the "hi-hat pedal" hint): a hi-hat note that always arrives with CC4 ~= 90 is
 * a strong signal for a `keyboardMapper` layer condition.
 */
import type { MidiEvent, MidiEventKind } from "./types.js";
import type { CcState } from "./context.js";

export interface ConcurrentCc {
  value: number; // last observed value while a hit landed
  min: number;
  max: number;
  count: number;
}

export interface LearnObservation {
  /** Stable identity, e.g. `noteOn:ch0:n36` or `cc:ch0:c4`. */
  signature: string;
  kind: MidiEventKind;
  channel: number;
  note?: number;
  controller?: number;
  count: number;
  velocityMin?: number;
  velocityMax?: number;
  valueMin?: number;
  valueMax?: number;
  firstSeen: number;
  lastSeen: number;
  /** controller number -> stats, for note kinds only. */
  concurrentCc: Record<number, ConcurrentCc>;
}

function signatureOf(ev: MidiEvent): string | null {
  switch (ev.kind) {
    case "noteOn":
    case "noteOff":
      return `${ev.kind}:ch${ev.channel}:n${ev.note}`;
    case "cc":
      return `cc:ch${ev.channel}:c${ev.controller}`;
    case "program":
      return `program:ch${ev.channel}`;
    case "pitchBend":
      return `pitchBend:ch${ev.channel}`;
    case "aftertouch":
      return `aftertouch:ch${ev.channel}${ev.note !== undefined ? `:n${ev.note}` : ""}`;
    case "raw":
      return null;
  }
}

/** CCs considered "active" (worth recording as a concurrent hint) at/above this. */
const CC_ACTIVE_THRESHOLD = 1;

export class LearnBuffer {
  private map = new Map<string, LearnObservation>();

  observe(ev: MidiEvent, cc?: CcState): void {
    const sig = signatureOf(ev);
    if (!sig) return;

    let o = this.map.get(sig);
    if (!o) {
      o = {
        signature: sig,
        kind: ev.kind,
        channel: "channel" in ev ? ev.channel : 0,
        firstSeen: ev.t,
        lastSeen: ev.t,
        count: 0,
        concurrentCc: {},
      };
      if (ev.kind === "noteOn" || ev.kind === "noteOff") o.note = ev.note;
      if (ev.kind === "cc") o.controller = ev.controller;
      this.map.set(sig, o);
    }

    o.count++;
    o.lastSeen = ev.t;

    if (ev.kind === "noteOn") {
      o.velocityMin = Math.min(o.velocityMin ?? 127, ev.velocity);
      o.velocityMax = Math.max(o.velocityMax ?? 0, ev.velocity);
      if (cc) this.recordConcurrentCc(o, ev.channel, cc);
    }
    if (ev.kind === "cc") {
      o.valueMin = Math.min(o.valueMin ?? 127, ev.value);
      o.valueMax = Math.max(o.valueMax ?? 0, ev.value);
    }
  }

  private recordConcurrentCc(o: LearnObservation, channel: number, cc: CcState): void {
    const perChannel = cc.snapshot()[channel];
    if (!perChannel) return;
    for (const [ctrlStr, value] of Object.entries(perChannel)) {
      if (value < CC_ACTIVE_THRESHOLD) continue;
      const ctrl = Number(ctrlStr);
      const c = (o.concurrentCc[ctrl] ??= { value, min: value, max: value, count: 0 });
      c.value = value;
      c.min = Math.min(c.min, value);
      c.max = Math.max(c.max, value);
      c.count++;
    }
  }

  list(): LearnObservation[] {
    return [...this.map.values()].sort((a, b) => {
      if (a.channel !== b.channel) return a.channel - b.channel;
      const an = a.note ?? a.controller ?? 0;
      const bn = b.note ?? b.controller ?? 0;
      return an - bn;
    });
  }

  clear(): void {
    this.map.clear();
  }
}
