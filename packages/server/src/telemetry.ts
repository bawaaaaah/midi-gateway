/**
 * Feeds the two live UI channels:
 *  - `monitor`: a throttled, CC-decimated stream of every event in/out
 *  - `activity`: aggregated held-notes + CC values per scope, for the
 *    piano-keyboard / pad-grid / CC-meter widgets
 */
import type {
  ActivityScope,
  ActivitySnapshot,
  MidiEvent,
  MonitorEvent,
  MonitorFilter,
} from "@midi-gateway/engine";

const MONITOR_CAP = 600;

interface ScopeState {
  held: Map<string, { channel: number; note: number; velocity: number; since: number }>;
  cc: Map<string, number>; // "ch:controller" -> value
}

export class Telemetry {
  private seq = 0;
  private pending: MonitorEvent[] = [];
  private scopes = new Map<string, ScopeState>();
  private portRates: ActivitySnapshot["ports"] = {};

  private scope(key: string): ScopeState {
    let s = this.scopes.get(key);
    if (!s) {
      s = { held: new Map(), cc: new Map() };
      this.scopes.set(key, s);
    }
    return s;
  }

  private applyToScope(key: string, ev: MidiEvent): void {
    const s = this.scope(key);
    if (ev.kind === "noteOn") {
      s.held.set(`${ev.channel}:${ev.note}`, {
        channel: ev.channel,
        note: ev.note,
        velocity: ev.velocity,
        since: ev.t,
      });
    } else if (ev.kind === "noteOff") {
      s.held.delete(`${ev.channel}:${ev.note}`);
    } else if (ev.kind === "cc") {
      s.cc.set(`${ev.channel}:${ev.controller}`, ev.value);
    }
  }

  recordIn(portId: string, portName: string, ev: MidiEvent): void {
    this.applyToScope(`port:${portId}`, ev);
    this.push({ seq: this.seq++, t: ev.t, stage: "in", portId, portName, event: ev });
  }

  recordOut(routeId: string, routeName: string, portId: string, portName: string, ev: MidiEvent): void {
    this.applyToScope(`route:${routeId}:out`, ev);
    this.push({ seq: this.seq++, t: ev.t, stage: "out", routeId, routeName, portId, portName, event: ev });
  }

  /** Drop a scope (route/port removed) so stale held-notes don't linger. */
  dropScope(prefix: string): void {
    for (const key of this.scopes.keys()) if (key.startsWith(prefix)) this.scopes.delete(key);
  }

  setPortRates(rates: ActivitySnapshot["ports"]): void {
    this.portRates = rates;
  }

  private push(m: MonitorEvent): void {
    this.pending.push(m);
    if (this.pending.length > MONITOR_CAP * 2) this.pending.splice(0, this.pending.length - MONITOR_CAP);
  }

  /** Return and clear the pending monitor batch, decimating continuous controllers. */
  drainMonitor(): MonitorEvent[] {
    if (this.pending.length === 0) return [];
    const batch = this.pending;
    this.pending = [];

    // Keep every note/program event; collapse cc/pitchBend/aftertouch to the
    // last value per (stage, port, channel, selector) so a knob sweep is one row.
    const lastContinuous = new Map<string, number>();
    const keep: MonitorEvent[] = [];
    for (let i = batch.length - 1; i >= 0; i--) {
      const m = batch[i]!;
      const k = m.event.kind;
      if (k === "cc" || k === "pitchBend" || k === "aftertouch") {
        const sel = k === "cc" ? m.event.controller : k;
        const ch = "channel" in m.event ? m.event.channel : 0;
        const key = `${m.stage}:${m.portId}:${ch}:${sel}`;
        if (lastContinuous.has(key)) continue;
        lastContinuous.set(key, m.seq);
      }
      keep.push(m);
    }
    keep.reverse();
    return keep.length > MONITOR_CAP ? keep.slice(keep.length - MONITOR_CAP) : keep;
  }

  static matchesFilter(m: MonitorEvent, f?: MonitorFilter): boolean {
    if (!f) return true;
    if (f.portIds?.length && !f.portIds.includes(m.portId)) return false;
    if (f.kinds?.length && !f.kinds.includes(m.event.kind)) return false;
    if (f.channels?.length) {
      const ch = "channel" in m.event ? m.event.channel : undefined;
      if (ch === undefined || !f.channels.includes(ch)) return false;
    }
    return true;
  }

  activitySnapshot(): ActivitySnapshot {
    const scopes: Record<string, ActivityScope> = {};
    for (const [key, s] of this.scopes) {
      if (s.held.size === 0 && s.cc.size === 0) continue;
      const cc: Record<number, Record<number, number>> = {};
      for (const [k, v] of s.cc) {
        const [ch, ctrl] = k.split(":").map(Number) as [number, number];
        (cc[ch] ??= {})[ctrl] = v;
      }
      scopes[key] = { heldNotes: [...s.held.values()], cc };
    }
    return { t: Date.now(), ports: this.portRates, scopes };
  }
}
