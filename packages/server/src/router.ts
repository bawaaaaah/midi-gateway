/**
 * Wires ports to engine chains: every incoming event is stamped, fed to each
 * route whose sources include the port, and the results are sent to that
 * route's destinations. Also drives time-based transforms (`combo`) and owns
 * learn mode.
 *
 * The router remembers which notes each route has sounding, so reconfiguring a
 * route (editing its chain, disabling it, removing a source or destination,
 * deleting it) never leaves a stuck note - whatever the transforms are.
 */
import {
  CcState,
  LearnBuffer,
  RouteChain,
  type LearnObservation,
  type MidiEvent,
  type Preset,
  type Route,
  type RouteContext,
} from "@midi-gateway/engine";
import type { PortRegistry } from "./midi/ports.js";
import type { Telemetry } from "./telemetry.js";

const TICK_MS = 4;

interface RouteEntry {
  /** Latest config. The store may mutate it in place, so never diff against it. */
  route: Route;
  chain: RouteChain;
  /** Outlives chain rebuilds: the CC state is the controller's physical state. */
  ctx: RouteContext;
  // Snapshots of what the entry is currently wired for.
  chainSig: string;
  enabled: boolean;
  sources: string[];
  destinations: string[];
  /** `channel:note` of every note-on sent to the destinations and not yet released. */
  sounding: Set<string>;
}

const chainSigOf = (r: Route) => JSON.stringify(r.transforms);
const noteKey = (channel: number, note: number) => `${channel}:${note}`;

export class Router {
  private routes = new Map<string, RouteEntry>();
  private sourceIndex = new Map<string, string[]>();
  private portNames = new Map<string, string>();
  private tickTimer?: NodeJS.Timeout;

  private learnActive = false;
  private learnRouteId: string | null = null;
  private readonly learn = new LearnBuffer();
  /** CC state across every input, for the "all inputs" learn hints. */
  private readonly learnCc = new CcState();

  constructor(
    private registry: PortRegistry,
    private telemetry: Telemetry,
  ) {
    this.registry.on("event", (portId: string, ev: MidiEvent) => this.onInput(portId, ev));
  }

  /**
   * Apply a (new or edited) preset. Call it *before* the registry closes ports
   * the preset no longer has, so their held notes can still be released.
   */
  setPreset(preset: Preset): void {
    this.portNames = new Map(preset.ports.map((p) => [p.id, p.name]));
    const next = new Map(preset.routes.map((r) => [r.id, r]));

    for (const [id, entry] of this.routes) {
      const nr = next.get(id);
      if (!nr) {
        this.silence(entry);
        this.routes.delete(id);
        this.telemetry.dropScope(`route:${id}:`);
        continue;
      }

      const chainSig = chainSigOf(nr);
      const chainChanged = chainSig !== entry.chainSig;
      const disabled = entry.enabled && !nr.enabled;
      // Notes started from a source that is no longer wired would never get their note-off.
      const lostSource = entry.sources.some((s) => !nr.sources.includes(s));
      if (chainChanged || disabled || lostSource) {
        this.silence(entry);
      } else {
        const dropped = entry.destinations.filter((d) => !nr.destinations.includes(d));
        if (dropped.length) this.releaseSounding(entry, dropped, false);
      }
      if (chainChanged) {
        entry.chain = RouteChain.fromRoute(nr);
        entry.chainSig = chainSig;
      }
      entry.route = nr;
      entry.enabled = nr.enabled;
      entry.sources = [...nr.sources];
      entry.destinations = [...nr.destinations];
    }

    for (const route of preset.routes) {
      if (this.routes.has(route.id)) continue;
      this.routes.set(route.id, {
        route,
        chain: RouteChain.fromRoute(route),
        ctx: { now: 0, cc: new CcState(), learn: undefined },
        chainSig: chainSigOf(route),
        enabled: route.enabled,
        sources: [...route.sources],
        destinations: [...route.destinations],
        sounding: new Set(),
      });
    }

    this.sourceIndex.clear();
    for (const route of preset.routes) {
      for (const src of new Set(route.sources)) {
        const list = this.sourceIndex.get(src) ?? [];
        list.push(route.id);
        this.sourceIndex.set(src, list);
      }
    }

    this.manageTick();
  }

  private onInput(portId: string, ev: MidiEvent): void {
    // Called from native MIDI / socket callbacks: an exception here would take
    // the whole gateway down, so contain it.
    try {
      this.telemetry.recordIn(portId, this.portNames.get(portId) ?? portId, ev);
      if (this.learnActive && this.learnRouteId === null) {
        // "All inputs": learn every raw input event exactly once, routed or not.
        if (ev.kind === "cc") this.learnCc.set(ev.channel, ev.controller, ev.value);
        this.learn.observe(ev, this.learnCc);
      }
    } catch (err) {
      console.error("[router] input:", err);
    }

    for (const routeId of this.sourceIndex.get(portId) ?? []) {
      const entry = this.routes.get(routeId);
      if (!entry) continue;
      try {
        const { ctx, chain } = entry;
        // Track the pedal even while the route is disabled, so it is right when re-enabled.
        if (ev.kind === "cc") ctx.cc.set(ev.channel, ev.controller, ev.value);
        if (!entry.enabled) continue;
        ctx.now = ev.t;

        // Learning this route: a learnTap decides what is learned; without one, learn the raw input.
        const learning = this.learnActive && this.learnRouteId === routeId;
        const tapped = learning && chain.has("learnTap");
        if (learning && !tapped) this.learn.observe(ev, ctx.cc);
        ctx.learn = tapped ? this.learn : undefined;

        this.dispatch(entry, chain.process(ev, ctx));
      } catch (err) {
        console.error(`[router] route "${entry.route.name}":`, err);
      }
    }
  }

  /** Send `events` to the route's destinations and keep track of what is sounding. */
  private dispatch(entry: RouteEntry, events: MidiEvent[]): void {
    if (events.length === 0) return;
    for (const ev of events) {
      if (ev.kind === "noteOn") entry.sounding.add(noteKey(ev.channel, ev.note));
      else if (ev.kind === "noteOff") entry.sounding.delete(noteKey(ev.channel, ev.note));
    }
    for (const destId of entry.destinations) {
      const name = this.portNames.get(destId) ?? destId;
      for (const ev of events) {
        this.registry.send(destId, ev);
        this.telemetry.recordOut(entry.route.id, entry.route.name, destId, name, ev);
      }
    }
  }

  /**
   * Note-offs for every note the route has sounding on `destinations`. With
   * `forget`, the notes are considered released everywhere.
   */
  private releaseSounding(entry: RouteEntry, destinations: string[], forget: boolean): void {
    if (entry.sounding.size === 0) return;
    const t = performance.now();
    const offs: MidiEvent[] = [...entry.sounding].map((k) => {
      const [channel, note] = k.split(":").map(Number) as [number, number];
      return { t, sourceId: "", kind: "noteOff", channel, note, velocity: 0 };
    });
    for (const destId of destinations) {
      const name = this.portNames.get(destId) ?? destId;
      for (const ev of offs) {
        this.registry.send(destId, ev);
        if (forget) this.telemetry.recordOut(entry.route.id, entry.route.name, destId, name, ev);
      }
    }
    if (forget) entry.sounding.clear();
  }

  /** Release everything the route holds: the chain's own state, then any note still sounding. */
  private silence(entry: RouteEntry): void {
    try {
      entry.ctx.now = performance.now();
      this.dispatch(entry, entry.chain.flush(entry.ctx));
    } catch (err) {
      console.error(`[router] flush "${entry.route.name}":`, err);
    }
    this.releaseSounding(entry, entry.destinations, true);
  }

  private manageTick(): void {
    const needed = [...this.routes.values()].some((e) => e.chain.needsTick);
    if (needed && !this.tickTimer) {
      this.tickTimer = setInterval(() => this.tickAll(), TICK_MS);
    } else if (!needed && this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = undefined;
    }
  }

  private tickAll(): void {
    const t = performance.now();
    for (const entry of this.routes.values()) {
      if (!entry.chain.needsTick || !entry.enabled) continue;
      try {
        entry.ctx.now = t;
        this.dispatch(entry, entry.chain.tick(t, entry.ctx));
      } catch (err) {
        console.error(`[router] tick "${entry.route.name}":`, err);
      }
    }
  }

  panic(routeId?: string): void {
    for (const entry of this.routes.values()) {
      if (routeId && entry.route.id !== routeId) continue;
      this.silence(entry);
      for (const destId of entry.destinations) this.registry.allNotesOff(destId);
    }
  }

  // learn -------------------------------------------------------------------

  learnStart(routeId?: string): void {
    this.learnActive = true;
    this.learnRouteId = routeId ?? null;
    this.learn.clear();
  }
  learnStop(): void {
    this.learnActive = false;
  }
  learnClear(): void {
    this.learn.clear();
  }
  learnObservations(): LearnObservation[] {
    return this.learn.list();
  }
  learnState(): { active: boolean; routeId: string | null } {
    return { active: this.learnActive, routeId: this.learnRouteId };
  }

  dispose(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = undefined;
    for (const entry of this.routes.values()) this.silence(entry);
    this.routes.clear();
  }
}
