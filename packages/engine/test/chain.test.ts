import { describe, expect, it } from "vitest";
import { RouteChain } from "../src/chain.js";
import { CcState, type RouteContext } from "../src/context.js";
import type { Route } from "../src/types.js";
import { LearnBuffer } from "../src/learn.js";
import { noteOn, noteOff, fmtAll, resetClock } from "./helpers.js";

function ctx(): RouteContext {
  return { now: 0, cc: new CcState(), learn: new LearnBuffer() };
}

describe("RouteChain", () => {
  it("runs transforms in order: pitch-class fold then transpose then channel remap", () => {
    resetClock();
    const route: Route = {
      id: "r1",
      name: "test",
      enabled: true,
      sources: [],
      destinations: [],
      transforms: [
        {
          id: "kbm",
          type: "keyboardMapper",
          enabled: true,
          partition: { mode: "byPitchClass" },
          layers: [{ id: "d", when: "default", buckets: { pc0: { note: 60 } } }],
        },
        { id: "tr", type: "transpose", enabled: true, semitones: 12 },
        { id: "cr", type: "channelRemap", enabled: true, map: { 0: 3 } },
      ],
    };
    const chain = RouteChain.fromRoute(route);
    const c = ctx();

    expect(fmtAll(chain.process(noteOn(48, 100), c))).toEqual(["on:ch3:72@100"]);
    expect(fmtAll(chain.process(noteOff(48), c))).toEqual(["off:ch3:72"]);
  });

  it("skips disabled transforms", () => {
    resetClock();
    const route: Route = {
      id: "r2",
      name: "t",
      enabled: true,
      sources: [],
      destinations: [],
      transforms: [{ id: "tr", type: "transpose", enabled: false, semitones: 12 }],
    };
    const chain = RouteChain.fromRoute(route);
    expect(fmtAll(chain.process(noteOn(60, 100), ctx()))).toEqual(["on:ch0:60@100"]);
    expect(chain.needsTick).toBe(false);
  });

  it("flush drains held notes across the chain", () => {
    resetClock();
    const route: Route = {
      id: "r3",
      name: "t",
      enabled: true,
      sources: [],
      destinations: [],
      transforms: [
        {
          id: "kbm",
          type: "keyboardMapper",
          enabled: true,
          partition: { mode: "byPitchClass" },
          layers: [{ id: "d", when: "default", buckets: { pc0: { note: 60 } } }],
        },
      ],
    };
    const chain = RouteChain.fromRoute(route);
    const c = ctx();
    chain.process(noteOn(48, 100), c);
    expect(fmtAll(chain.flush(c))).toEqual(["off:ch0:60"]);
  });
});
