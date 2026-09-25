import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { emptyPreset, type MidiEvent, type Preset, type Route, type TransformConfig } from "@midi-gateway/engine";
import { Router } from "../src/router.js";
import { Telemetry } from "../src/telemetry.js";
import type { PortRegistry } from "../src/midi/ports.js";

/** Stand-in for the port registry: records what is sent to each port. */
class FakeRegistry extends EventEmitter {
  sent: { port: string; ev: MidiEvent }[] = [];
  send(port: string, ev: MidiEvent): void {
    this.sent.push({ port, ev });
  }
  allNotesOff(): void {}
  input(port: string, ev: Partial<MidiEvent> & { kind: MidiEvent["kind"] }): void {
    this.emit("event", port, { t: performance.now(), sourceId: port, channel: 0, ...ev } as MidiEvent);
  }
  /** Sent events as compact strings, then forget them. */
  take(): string[] {
    const out = this.sent.map(({ port, ev }) => {
      if (ev.kind === "noteOn") return `${port} on:${ev.channel}:${ev.note}`;
      if (ev.kind === "noteOff") return `${port} off:${ev.channel}:${ev.note}`;
      if (ev.kind === "cc") return `${port} cc:${ev.controller}=${ev.value}`;
      return `${port} ${ev.kind}`;
    });
    this.sent = [];
    return out;
  }
}

function setup(transforms: TransformConfig[] = [], extra: Partial<Route> = {}) {
  const registry = new FakeRegistry();
  const router = new Router(registry as unknown as PortRegistry, new Telemetry());
  const route: Route = {
    id: "r",
    name: "r",
    enabled: true,
    sources: ["in"],
    destinations: ["out"],
    transforms,
    ...extra,
  };
  const preset: Preset = { ...emptyPreset("t"), routes: [route] };
  router.setPreset(preset);
  /** Apply an edit the way the store does (in place), then re-sync. */
  const edit = (fn: (r: Route, p: Preset) => void) => {
    fn(route, preset);
    router.setPreset(preset);
  };
  return { registry, router, route, preset, edit };
}

const transpose = (semitones: number): TransformConfig => ({ id: "tr", type: "transpose", enabled: true, semitones });

describe("Router - no stuck notes when a route changes under a held note", () => {
  it("disabling the route releases the held note", () => {
    const { registry, edit } = setup();
    registry.input("in", { kind: "noteOn", note: 60, velocity: 100 });
    expect(registry.take()).toEqual(["out on:0:60"]);
    edit((r) => (r.enabled = false));
    expect(registry.take()).toEqual(["out off:0:60"]);
    registry.input("in", { kind: "noteOff", note: 60, velocity: 0 });
    expect(registry.take()).toEqual([]);
  });

  it("editing a stateless transform releases the note it actually sent", () => {
    const { registry, edit } = setup([transpose(12)]);
    registry.input("in", { kind: "noteOn", note: 60, velocity: 100 });
    expect(registry.take()).toEqual(["out on:0:72"]);
    edit((r) => (r.transforms = [transpose(7)]));
    expect(registry.take()).toEqual(["out off:0:72"]);
  });

  it("removing a destination releases the notes held there only", () => {
    const { registry, edit } = setup([], { destinations: ["out", "out2"] });
    registry.input("in", { kind: "noteOn", note: 60, velocity: 100 });
    expect(registry.take()).toEqual(["out on:0:60", "out2 on:0:60"]);
    edit((r) => (r.destinations = r.destinations.filter((d) => d !== "out2")));
    expect(registry.take()).toEqual(["out2 off:0:60"]);
    registry.input("in", { kind: "noteOff", note: 60, velocity: 0 });
    expect(registry.take()).toEqual(["out off:0:60"]);
  });

  it("deleting the route releases its notes", () => {
    const { registry, edit } = setup();
    registry.input("in", { kind: "noteOn", note: 36, velocity: 100 });
    registry.take();
    edit((_r, p) => (p.routes = []));
    expect(registry.take()).toEqual(["out off:0:36"]);
  });

  it("panic releases what the route holds", () => {
    const { registry, router } = setup([transpose(1)]);
    registry.input("in", { kind: "noteOn", note: 60, velocity: 100 });
    registry.take();
    router.panic();
    expect(registry.take()).toEqual(["out off:0:61"]);
  });
});

describe("Router - pedal state", () => {
  const hihat: TransformConfig = {
    id: "hh",
    type: "keyboardMapper",
    enabled: true,
    partition: { mode: "explicitList", groups: [{ id: "hh", notes: [46] }] },
    layers: [
      { id: "closed", when: { cc: 4, min: 81 }, buckets: { hh: { note: 42 } } },
      { id: "open", when: "default", buckets: { hh: { note: 46 } } },
    ],
  };

  it("keeps the CC state when the chain is rebuilt", () => {
    const { registry, edit } = setup([hihat]);
    registry.input("in", { kind: "cc", controller: 4, value: 127 }); // pedal closed
    registry.take();
    edit((r) => (r.transforms = [{ ...hihat, label: "edited" }]));
    registry.input("in", { kind: "noteOn", note: 46, velocity: 100 });
    expect(registry.take()).toEqual(["out on:0:42"]);
  });

  it("tracks the pedal while the route is disabled", () => {
    const { registry, edit } = setup([hihat]);
    edit((r) => (r.enabled = false));
    registry.input("in", { kind: "cc", controller: 4, value: 127 });
    edit((r) => (r.enabled = true));
    registry.input("in", { kind: "noteOn", note: 46, velocity: 100 });
    expect(registry.take()).toEqual(["out on:0:42"]);
  });
});

describe("Router - learn", () => {
  it("'all inputs' learns each input event once, even when it feeds several routes", () => {
    const registry = new FakeRegistry();
    const router = new Router(registry as unknown as PortRegistry, new Telemetry());
    const route = (id: string): Route => ({
      id,
      name: id,
      enabled: true,
      sources: ["in"],
      destinations: ["out"],
      transforms: [{ id: "tap", type: "learnTap", enabled: true }],
    });
    router.setPreset({ ...emptyPreset("t"), routes: [route("a"), route("b")] });
    router.learnStart();
    registry.input("in", { kind: "noteOn", note: 38, velocity: 90 });
    registry.input("unrouted", { kind: "noteOn", note: 40, velocity: 90 });
    const obs = router.learnObservations();
    expect(obs.map((o) => [o.note, o.count])).toEqual([
      [38, 1],
      [40, 1],
    ]);
  });

  it("a route's learnTap decides what that route learns", () => {
    const { registry, router } = setup([transpose(12), { id: "tap", type: "learnTap", enabled: true }]);
    router.learnStart("r");
    registry.input("in", { kind: "noteOn", note: 36, velocity: 90 });
    expect(router.learnObservations().map((o) => [o.note, o.count])).toEqual([[48, 1]]);
  });

  it("a route without a learnTap learns its raw input", () => {
    const { registry, router } = setup([transpose(12)]);
    router.learnStart("r");
    registry.input("in", { kind: "noteOn", note: 36, velocity: 90 });
    expect(router.learnObservations().map((o) => [o.note, o.count])).toEqual([[36, 1]]);
  });
});
