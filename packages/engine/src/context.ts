/** Shared runtime context handed to every transform in a route's chain. */
import type { MidiEvent } from "./types.js";
import type { LearnBuffer } from "./learn.js";

/** Last-known value of every CC, keyed by `channel:controller`. */
export class CcState {
  private m = new Map<string, number>();

  set(channel: number, controller: number, value: number): void {
    this.m.set(`${channel}:${controller}`, value);
  }

  get(channel: number, controller: number): number {
    return this.m.get(`${channel}:${controller}`) ?? 0;
  }

  /** Every known CC on any channel: `{ [channel]: { [controller]: value } }`. */
  snapshot(): Record<number, Record<number, number>> {
    const out: Record<number, Record<number, number>> = {};
    for (const [k, v] of this.m) {
      const [ch, cc] = k.split(":").map(Number) as [number, number];
      (out[ch] ??= {})[cc] = v;
    }
    return out;
  }

  clear(): void {
    this.m.clear();
  }
}

export interface RouteContext {
  /** Timestamp (ms) of the event currently being processed. */
  now: number;
  /** Physical CC state, updated from input events before transforms run. */
  cc: CcState;
  /** Present only while a route (or the whole engine) is in learn mode. */
  learn?: LearnBuffer;
}

export interface Transform {
  readonly id: string;
  readonly type: string;
  /** Turn one event into zero or more events. */
  process(ev: MidiEvent, ctx: RouteContext): MidiEvent[];
  /** Called on a timer; lets time-based transforms (combo) flush expired state. */
  tick?(now: number, ctx: RouteContext): MidiEvent[];
  /** Emit note-offs for everything held, e.g. on disable / panic / preset swap. */
  flush?(ctx: RouteContext): MidiEvent[];
}
