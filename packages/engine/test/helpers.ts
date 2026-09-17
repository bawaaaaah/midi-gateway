import { CcState, type RouteContext } from "../src/context.js";
import type { Transform } from "../src/context.js";
import type { MidiEvent } from "../src/types.js";
import { LearnBuffer } from "../src/learn.js";

let clock = 0;

export function resetClock(): void {
  clock = 0;
}

type EventInput = Partial<MidiEvent> & { kind: MidiEvent["kind"] };

/** Build an event, auto-stamping `t` (monotonic +1ms) and a default channel 0. */
export function ev(input: EventInput & Record<string, unknown>): MidiEvent {
  clock += 1;
  return { t: clock, sourceId: "test", channel: 0, ...input } as MidiEvent;
}

export const noteOn = (note: number, velocity = 100, channel = 0): MidiEvent =>
  ev({ kind: "noteOn", note, velocity, channel });
export const noteOff = (note: number, channel = 0): MidiEvent =>
  ev({ kind: "noteOff", note, velocity: 0, channel });
export const cc = (controller: number, value: number, channel = 0): MidiEvent =>
  ev({ kind: "cc", controller, value, channel });

export interface Harness {
  ctx: RouteContext;
  learn: LearnBuffer;
  /** Feed one event; CC events update ctx.cc first (as the router does). */
  feed(e: MidiEvent): MidiEvent[];
  /** Feed several, concatenating all output. */
  feedAll(es: MidiEvent[]): MidiEvent[];
  tick(atMs?: number): MidiEvent[];
  flush(): MidiEvent[];
}

export function harness(t: Transform): Harness {
  const learn = new LearnBuffer();
  const ctx: RouteContext = { now: 0, cc: new CcState(), learn };

  const feed = (e: MidiEvent): MidiEvent[] => {
    ctx.now = e.t;
    if (e.kind === "cc") ctx.cc.set(e.channel, e.controller, e.value);
    return t.process(e, ctx);
  };

  return {
    ctx,
    learn,
    feed,
    feedAll: (es) => es.flatMap(feed),
    tick: (atMs) => {
      if (atMs !== undefined) ctx.now = atMs;
      return t.tick?.(ctx.now, ctx) ?? [];
    },
    flush: () => t.flush?.(ctx) ?? [],
  };
}

/** Compact string form for readable assertions, e.g. "on:ch0:60@100". */
export function fmt(e: MidiEvent): string {
  switch (e.kind) {
    case "noteOn":
      return `on:ch${e.channel}:${e.note}@${e.velocity}`;
    case "noteOff":
      return `off:ch${e.channel}:${e.note}`;
    case "cc":
      return `cc:ch${e.channel}:${e.controller}=${e.value}`;
    default:
      return e.kind;
  }
}

export const fmtAll = (es: MidiEvent[]): string[] => es.map(fmt);
