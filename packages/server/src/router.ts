/**
 * Wires ports to engine chains: every incoming event is stamped, fed to each
 * route whose sources include the port, and the results are sent to that
 * route's destinations. Also drives time-based transforms (`combo`) and owns
 * learn mode.
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
  route: Route;
  chain: RouteChain;
  ctx: RouteContext;
  transformSig: string;
}

const transformSig = (r: Route) => JSON.stringify(r.transforms);

export class Router {
  private routes = new Map<string, RouteEntry>();
  private sourceIndex = new Map<string, string[]>();
  private portNames = new Map<string, string>();
  private tickTimer?: NodeJS.Timeout;

  private learnActive = false;
  private learnRouteId: string | null = null;
  private readonly learn = new LearnBuffer();

  constructor(
    private registry: PortRegistry,
    private telemetry: Telemetry,
  ) {
    this.registry.on("event", (portId: string, ev: MidiEvent) => this.onInput(portId, ev));
  }

  setPreset(preset: Preset): void {
    this.portNames = new Map(preset.ports.map((p) => [p.id, p.name]));
    const next = new Map(preset.routes.map((r) => [r.id, r]));

    for (const [id, entry] of this.routes) {
      const nr = next.get(id);
      if (!nr || transformSig(nr) !== entry.transformSig) {
        this.dispatch(entry.route, entry.chain.flush(entry.ctx));
        this.routes.delete(id);
        this.telemetry.dropScope(`route:${id}:`);
      }
    }

    for (const route of preset.routes) {
      const existing = this.routes.get(route.id);
      if (existing) {
        existing.route = route; // sources/destinations/name/enabled may have changed
        continue;
      }
      this.routes.set(route.id, {
        route,
        chain: RouteChain.fromRoute(route),
        ctx: { now: 0, cc: new CcState(), learn: undefined },
        transformSig: transformSig(route),
      });
    }

    this.sourceIndex.clear();
    for (const route of preset.routes) {
      for (const src of route.sources) {
        const list = this.sourceIndex.get(src) ?? [];
        list.push(route.id);
        this.sourceIndex.set(src, list);
      }
    }

    this.manageTick();
  }

  private onInput(portId: string, ev: MidiEvent): void {
    this.telemetry.recordIn(portId, this.portNames.get(portId) ?? portId, ev);

    for (const routeId of this.sourceIndex.get(portId) ?? []) {
      const entry = this.routes.get(routeId);
      if (!entry || !entry.route.enabled) continue;

      const { ctx, chain, route } = entry;
      ctx.now = ev.t;
      if (ev.kind === "cc") ctx.cc.set(ev.channel, ev.controller, ev.value);

      const learning = this.learnActive && (this.learnRouteId === null || this.learnRouteId === routeId);
      if (learning) {
        this.learn.observe(ev, ctx.cc);
        ctx.learn = this.learn;
      } else {
        ctx.learn = undefined;
      }

      this.dispatch(route, chain.process(ev, ctx));
    }
  }

  private dispatch(route: Route, events: MidiEvent[]): void {
    if (events.length === 0) return;
    for (const destId of route.destinations) {
      const name = this.portNames.get(destId) ?? destId;
      for (const ev of events) {
        this.registry.send(destId, ev);
        this.telemetry.recordOut(route.id, route.name, destId, name, ev);
      }
    }
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
      if (!entry.chain.needsTick || !entry.route.enabled) continue;
      entry.ctx.now = t;
      this.dispatch(entry.route, entry.chain.tick(t, entry.ctx));
    }
  }

  panic(routeId?: string): void {
    for (const entry of this.routes.values()) {
      if (routeId && entry.route.id !== routeId) continue;
      this.dispatch(entry.route, entry.chain.flush(entry.ctx));
      for (const destId of entry.route.destinations) this.registry.allNotesOff(destId);
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
    for (const entry of this.routes.values()) this.dispatch(entry.route, entry.chain.flush(entry.ctx));
    this.routes.clear();
  }
}
