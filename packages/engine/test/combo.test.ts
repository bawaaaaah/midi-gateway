import { describe, expect, it } from "vitest";
import { createCombo } from "../src/transforms/combo.js";
import type { TransformConfig } from "../src/types.js";
import { harness, noteOn, noteOff, cc, ev, fmtAll, resetClock } from "./helpers.js";

type Cfg = Extract<TransformConfig, { type: "combo" }>;

function combo(extra: Partial<Cfg>): Cfg {
  return {
    id: "c1",
    type: "combo",
    enabled: true,
    windowMs: 30,
    triggers: [],
    output: { note: 99 },
    suppressTriggers: true,
    ...extra,
  } as Cfg;
}

describe("combo", () => {
  it("fires a replacement note when a CC trigger + a note trigger land within the window", () => {
    resetClock();
    const t = createCombo(
      combo({
        triggers: [
          { id: "pedal", kind: "ccAbove", value: 4, threshold: 80 },
          { id: "hit", kind: "note", value: 46 },
        ],
        output: { note: 99, channel: 0 },
      }),
    );
    const h = harness(t);

    h.feed(cc(4, 120)); // pedal down -> trigger satisfied
    const out = h.feed(noteOn(46, 100)); // hit within window -> combo, hit suppressed
    expect(fmtAll(out)).toEqual(["on:ch0:99@100"]);

    expect(fmtAll(h.feed(noteOff(46)))).toEqual(["off:ch0:99"]); // release ends the combo note
  });

  it("does not fire when the trigger times are further apart than the window", () => {
    resetClock();
    const t = createCombo(
      combo({
        windowMs: 20,
        triggers: [
          { id: "pedal", kind: "ccAbove", value: 4, threshold: 80 },
          { id: "hit", kind: "note", value: 46 },
        ],
        suppressTriggers: false,
      }),
    );
    const h = harness(t);

    h.feed(ev({ kind: "cc", controller: 4, value: 120, t: 0 })); // pedal satisfied at 0
    const out = h.feed(ev({ kind: "noteOn", note: 46, velocity: 100, t: 200 })); // 200ms later
    expect(fmtAll(out)).toEqual(["on:ch0:46@100"]); // just the hit, no combo note
  });

  it("flushes a suppressed hit when no partner arrives in time", () => {
    resetClock();
    const t = createCombo(
      combo({
        windowMs: 15,
        triggers: [
          { id: "a", kind: "note", value: 40 },
          { id: "b", kind: "note", value: 42 },
        ],
      }),
    );
    const h = harness(t);

    expect(fmtAll(h.feed(noteOn(40, 100)))).toEqual([]); // held back
    expect(fmtAll(h.tick(50))).toEqual(["on:ch0:40@100"]); // no partner -> released late
  });

  it("releases a suppressed hit immediately if it is let go before completing", () => {
    resetClock();
    const t = createCombo(
      combo({
        windowMs: 50,
        triggers: [
          { id: "a", kind: "note", value: 40 },
          { id: "b", kind: "note", value: 42 },
        ],
      }),
    );
    const h = harness(t);
    expect(fmtAll(h.feed(noteOn(40, 100)))).toEqual([]);
    expect(fmtAll(h.feed(noteOff(40)))).toEqual(["on:ch0:40@100", "off:ch0:40"]);
  });
});
