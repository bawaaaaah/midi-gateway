/**
 * A live, ordered chain of transforms for one route. Stateful: build it once
 * from a {@link Route}, feed it events, and rebuild it when the route config
 * changes (call {@link RouteChain.flush} first to release held notes).
 */
import type { MidiEvent, Route, TransformConfig } from "./types.js";
import type { RouteContext, Transform } from "./context.js";
import { createTransform } from "./transforms/index.js";

export class RouteChain {
  readonly routeId: string;
  private transforms: Transform[];

  constructor(routeId: string, configs: TransformConfig[]) {
    this.routeId = routeId;
    this.transforms = configs.filter((c) => c.enabled).map(createTransform);
  }

  static fromRoute(route: Route): RouteChain {
    return new RouteChain(route.id, route.transforms);
  }

  /** True if any transform has time-based behaviour that needs {@link tick}. */
  get needsTick(): boolean {
    return this.transforms.some((t) => typeof t.tick === "function");
  }

  /** True if an enabled transform of this type is in the chain. */
  has(type: TransformConfig["type"]): boolean {
    return this.transforms.some((t) => t.type === type);
  }

  /** Run one event through the whole chain. */
  process(ev: MidiEvent, ctx: RouteContext): MidiEvent[] {
    let stream: MidiEvent[] = [ev];
    for (const tr of this.transforms) {
      if (stream.length === 0) break;
      const next: MidiEvent[] = [];
      for (const e of stream) next.push(...tr.process(e, ctx));
      stream = next;
    }
    return stream;
  }

  /** Drive time-based transforms; their output flows through downstream transforms. */
  tick(now: number, ctx: RouteContext): MidiEvent[] {
    let stream: MidiEvent[] = [];
    for (const tr of this.transforms) {
      const next: MidiEvent[] = [];
      for (const e of stream) next.push(...tr.process(e, ctx));
      if (tr.tick) next.push(...tr.tick(now, ctx));
      stream = next;
    }
    return stream;
  }

  /**
   * Note-offs for everything the chain is holding (route disabled / preset swap / panic).
   * Like {@link tick}, what a transform releases flows through the downstream
   * transforms, so the note-offs match what was actually sent (e.g. a folded
   * note that a later `transpose` shifted).
   */
  flush(ctx: RouteContext): MidiEvent[] {
    let stream: MidiEvent[] = [];
    for (const tr of this.transforms) {
      const next: MidiEvent[] = [];
      for (const e of stream) next.push(...tr.process(e, ctx));
      if (tr.flush) next.push(...tr.flush(ctx));
      stream = next;
    }
    return stream;
  }
}
