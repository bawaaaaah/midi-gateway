import { describe, expect, it } from "vitest";
import { createKeyboardMapper } from "../src/transforms/keyboardMapper.js";
import { transformConfigSchema } from "../src/presetSchema.js";
import type { Layer, Partition, TransformConfig } from "../src/types.js";
import { harness, noteOn, noteOff, cc, fmtAll, resetClock } from "./helpers.js";

type Cfg = Extract<TransformConfig, { type: "keyboardMapper" }>;

function kbm(partition: Partition, layers: Layer[], extra: Partial<Cfg> = {}): Cfg {
  return { id: "k1", type: "keyboardMapper", enabled: true, partition, layers, ...extra };
}
const dflt = (buckets: Layer["buckets"]): Layer => ({ id: "d", when: "default", buckets });

describe("keyboardMapper - piano: group by pitch class", () => {
  it("folds every C onto one chosen note and pairs the note-offs", () => {
    resetClock();
    const t = createKeyboardMapper(kbm({ mode: "byPitchClass" }, [dflt({ pc0: { note: 60 } })]));
    const h = harness(t);

    expect(fmtAll(h.feed(noteOn(48, 100)))).toEqual(["on:ch0:60@100"]); // C3
    expect(fmtAll(h.feed(noteOn(72, 90)))).toEqual([]); // C5 folds to the same sounding note
    expect(fmtAll(h.feed(noteOff(48)))).toEqual([]);
    expect(fmtAll(h.feed(noteOff(72)))).toEqual(["off:ch0:60"]); // stops on last release
  });

  it("passes notes with no matching bucket straight through", () => {
    resetClock();
    const t = createKeyboardMapper(kbm({ mode: "byPitchClass" }, [dflt({ pc0: { note: 60 } })]));
    const h = harness(t);
    expect(fmtAll(h.feed(noteOn(62, 100)))).toEqual(["on:ch0:62@100"]); // D, no pc2 bucket
  });
});

describe("keyboardMapper - piano: subdivide every X keys", () => {
  const part: Partition = { mode: "rangeGenerator", start: 21, size: 12, count: 3 };
  const layers = [dflt({ z0: { note: 36 }, z1: { note: 38 }, z2: { note: 40 } })];

  it("maps each zone to a single note", () => {
    resetClock();
    const h = harness(createKeyboardMapper(kbm(part, layers)));
    expect(fmtAll(h.feed(noteOn(25, 100)))).toEqual(["on:ch0:36@100"]); // zone 0
    expect(fmtAll(h.feed(noteOn(40, 100)))).toEqual(["on:ch0:38@100"]); // zone 1
    expect(fmtAll(h.feed(noteOn(50, 100)))).toEqual(["on:ch0:40@100"]); // zone 2
  });

  it("passes notes outside the generated range through", () => {
    resetClock();
    const h = harness(createKeyboardMapper(kbm(part, layers)));
    expect(fmtAll(h.feed(noteOn(100, 100)))).toEqual(["on:ch0:100@100"]);
  });
});

describe("keyboardMapper - expression pedal layer", () => {
  it("transposes the whole keyboard only while the pedal is pressed", () => {
    resetClock();
    const t = createKeyboardMapper(
      kbm({ mode: "identity" }, [
        { id: "pedal", when: { cc: 11, min: 64 }, buckets: { all: { transpose: 12 } } },
        dflt({}), // released: passthrough
      ]),
    );
    const h = harness(t);

    expect(fmtAll(h.feed(noteOn(60, 100)))).toEqual(["on:ch0:60@100"]);
    expect(fmtAll(h.feed(noteOff(60)))).toEqual(["off:ch0:60"]);

    h.feed(cc(11, 127)); // press pedal
    expect(fmtAll(h.feed(noteOn(60, 100)))).toEqual(["on:ch0:72@100"]);
  });

  it("combines with pitch-class grouping: grouped note differs with the pedal", () => {
    resetClock();
    const t = createKeyboardMapper(
      kbm({ mode: "byPitchClass" }, [
        { id: "pedal", when: { cc: 11, min: 64 }, buckets: { pc0: { note: 84 } } },
        dflt({ pc0: { note: 60 } }),
      ]),
    );
    const h = harness(t);
    expect(fmtAll(h.feed(noteOn(48, 100)))).toEqual(["on:ch0:60@100"]);
    h.feed(noteOff(48));
    h.feed(cc(11, 100));
    expect(fmtAll(h.feed(noteOn(48, 100)))).toEqual(["on:ch0:84@100"]);
  });

  it("does not leave a stuck note when the pedal is released mid-note", () => {
    resetClock();
    const t = createKeyboardMapper(
      kbm({ mode: "identity" }, [
        { id: "pedal", when: { cc: 11, min: 64 }, buckets: { all: { transpose: 12 } } },
        dflt({}),
      ]),
    );
    const h = harness(t);

    h.feed(cc(11, 127)); // pedal down
    expect(fmtAll(h.feed(noteOn(60, 100)))).toEqual(["on:ch0:72@100"]);
    h.feed(cc(11, 0)); // pedal up while note held
    // Note-off must target the note that actually sounded (72), not 60.
    expect(fmtAll(h.feed(noteOff(60)))).toEqual(["off:ch0:72"]);
  });
});

describe("keyboardMapper - hi-hat / charleston by pedal position", () => {
  it("chooses open / half / closed from the hi-hat pedal CC, sampled at note-on", () => {
    resetClock();
    const t = createKeyboardMapper(
      kbm({ mode: "explicitList", groups: [{ id: "hh", notes: [46] }] }, [
        { id: "closed", when: { cc: 4, min: 41 }, buckets: { hh: { note: 82, name: "HH closed" } } },
        { id: "half", when: { cc: 4, min: 1, max: 40 }, buckets: { hh: { note: 81, name: "HH half" } } },
        dflt({ hh: { note: 80, name: "HH open" } }),
      ]),
    );
    const h = harness(t);

    expect(fmtAll(h.feed(noteOn(46, 120)))).toEqual(["on:ch0:80@120"]); // pedal up -> open
    h.feed(noteOff(46));
    h.feed(cc(4, 20));
    expect(fmtAll(h.feed(noteOn(46, 120)))).toEqual(["on:ch0:81@120"]); // half
    h.feed(noteOff(46));
    h.feed(cc(4, 110));
    expect(fmtAll(h.feed(noteOn(46, 120)))).toEqual(["on:ch0:82@120"]); // closed
  });
});

describe("keyboardMapper - misc", () => {
  it("applies the bucket velocity spec", () => {
    resetClock();
    const t = createKeyboardMapper(
      kbm({ mode: "byPitchClass" }, [dflt({ pc0: { note: 60, velocity: { mode: "fixed", value: 20 } } })]),
    );
    const h = harness(t);
    expect(fmtAll(h.feed(noteOn(48, 100)))).toEqual(["on:ch0:60@20"]);
  });

  it("leaves other channels untouched when a channel filter is set", () => {
    resetClock();
    const t = createKeyboardMapper(
      kbm({ mode: "byPitchClass" }, [dflt({ pc0: { note: 60 } })], { channels: [9] }),
    );
    const h = harness(t);
    expect(fmtAll(h.feed(noteOn(48, 100, 0)))).toEqual(["on:ch0:48@100"]); // ch 0 not in scope
  });

  it("flush releases everything still held", () => {
    resetClock();
    const t = createKeyboardMapper(kbm({ mode: "byPitchClass" }, [dflt({ pc0: { note: 60 } })]));
    const h = harness(t);
    h.feed(noteOn(48, 100));
    expect(fmtAll(h.flush())).toEqual(["off:ch0:60"]);
  });
});

describe("keyboardMapper - retrigger option", () => {
  const folded = (retrigger?: boolean) =>
    createKeyboardMapper(kbm({ mode: "byPitchClass" }, [dflt({ pc0: { note: 60 } })], { retrigger }));

  it("is off by default: a second key on a sounding note is silent", () => {
    resetClock();
    const h = harness(folded());
    expect(fmtAll(h.feed(noteOn(48, 100)))).toEqual(["on:ch0:60@100"]);
    expect(fmtAll(h.feed(noteOn(72, 90)))).toEqual([]);
  });

  it("re-plays a folded note on every hit and still stops on the last release", () => {
    resetClock();
    const h = harness(folded(true));
    expect(fmtAll(h.feed(noteOn(48, 100)))).toEqual(["on:ch0:60@100"]);
    expect(fmtAll(h.feed(noteOn(72, 90)))).toEqual(["off:ch0:60", "on:ch0:60@90"]);
    expect(fmtAll(h.feed(noteOff(48)))).toEqual([]);
    expect(fmtAll(h.feed(noteOff(72)))).toEqual(["off:ch0:60"]);
  });

  it("re-plays when a key held with others is struck again", () => {
    resetClock();
    const h = harness(folded(true));
    h.feed(noteOn(48, 100));
    h.feed(noteOn(72, 90));
    expect(fmtAll(h.feed(noteOn(48, 70)))).toEqual(["off:ch0:60", "on:ch0:60@70"]);
    expect(fmtAll(h.feed(noteOff(48)))).toEqual([]);
    expect(fmtAll(h.feed(noteOff(72)))).toEqual(["off:ch0:60"]);
  });

  it("round-trips through the preset schema", () => {
    const cfg = kbm({ mode: "identity" }, [dflt({})], { retrigger: true });
    expect(transformConfigSchema.parse(cfg)).toEqual(cfg);
  });
});
