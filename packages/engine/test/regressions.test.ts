import { describe, expect, it } from "vitest";
import { RouteChain } from "../src/chain.js";
import { CcState, type RouteContext } from "../src/context.js";
import { LearnBuffer } from "../src/learn.js";
import { createFilter } from "../src/transforms/filter.js";
import { createCcRemap } from "../src/transforms/ccRemap.js";
import { createKeyboardMapper } from "../src/transforms/keyboardMapper.js";
import { parsePreset } from "../src/presetSchema.js";
import type { MidiEvent, TransformConfig } from "../src/types.js";
import { harness, noteOn, noteOff, cc, ev, fmtAll, resetClock } from "./helpers.js";

type KbmCfg = Extract<TransformConfig, { type: "keyboardMapper" }>;
type FilterCfg = Extract<TransformConfig, { type: "filter" }>;

const ctx = (): RouteContext => ({ now: 0, cc: new CcState(), learn: new LearnBuffer() });

describe("RouteChain.flush", () => {
  it("runs a transform's releases through the downstream transforms", () => {
    resetClock();
    const chain = new RouteChain("r", [
      {
        id: "kbm",
        type: "keyboardMapper",
        enabled: true,
        partition: { mode: "byPitchClass" },
        layers: [{ id: "d", when: "default", buckets: { pc0: { note: 60 } } }],
      },
      { id: "tr", type: "transpose", enabled: true, semitones: 12 },
      { id: "cr", type: "channelRemap", enabled: true, map: { 0: 3 } },
    ]);
    const c = ctx();
    expect(fmtAll(chain.process(noteOn(48, 100), c))).toEqual(["on:ch3:72@100"]);
    // The note-off must target what was sent (72 on ch3), not the mapper's raw output (60 on ch0).
    expect(fmtAll(chain.flush(c))).toEqual(["off:ch3:72"]);
  });

  it("reports which transform types are in the chain", () => {
    const chain = new RouteChain("r", [
      { id: "tap", type: "learnTap", enabled: true },
      { id: "tr", type: "transpose", enabled: false, semitones: 1 },
    ]);
    expect(chain.has("learnTap")).toBe(true);
    expect(chain.has("transpose")).toBe(false); // disabled transforms are not built
  });
});

describe("filter keeps note-on / note-off pairs together", () => {
  const filter = (extra: Partial<FilterCfg>): FilterCfg =>
    ({ id: "f", type: "filter", enabled: true, action: "keep", match: {}, ...extra }) as FilterCfg;

  it("'keep noteOn only' still lets the matching note-off through", () => {
    resetClock();
    const h = harness(createFilter(filter({ action: "keep", match: { kinds: ["noteOn"] } })));
    expect(fmtAll(h.feed(noteOn(60, 100)))).toEqual(["on:ch0:60@100"]);
    expect(fmtAll(h.feed(noteOff(60)))).toEqual(["off:ch0:60"]);
    expect(fmtAll(h.feed(cc(1, 10)))).toEqual([]);
  });

  it("a velocity gate drops the note-off of a dropped ghost note", () => {
    resetClock();
    const h = harness(createFilter(filter({ action: "drop", match: { kinds: ["noteOn"], velocityMax: 10 } })));
    expect(fmtAll(h.feed(noteOn(38, 5)))).toEqual([]);
    expect(fmtAll(h.feed(noteOff(38)))).toEqual([]);
    expect(fmtAll(h.feed(noteOn(38, 90)))).toEqual(["on:ch0:38@90"]);
    expect(fmtAll(h.feed(noteOff(38)))).toEqual(["off:ch0:38"]);
  });
});

describe("keyboardMapper edge cases", () => {
  const kbm = (buckets: KbmCfg["layers"][number]["buckets"]): KbmCfg => ({
    id: "k",
    type: "keyboardMapper",
    enabled: true,
    partition: { mode: "identity" },
    layers: [{ id: "d", when: "default", buckets }],
  });

  it("swallows the note-off of a note-on dropped for being out of range", () => {
    resetClock();
    const h = harness(createKeyboardMapper(kbm({ all: { transpose: 24 } })));
    expect(fmtAll(h.feed(noteOn(120, 100)))).toEqual([]);
    expect(fmtAll(h.feed(noteOff(120)))).toEqual([]);
  });

  it("sends poly aftertouch to the note the note-on produced, even if the pedal moved", () => {
    resetClock();
    const t = createKeyboardMapper({
      id: "k",
      type: "keyboardMapper",
      enabled: true,
      partition: { mode: "identity" },
      layers: [
        { id: "p", when: { cc: 11, min: 64 }, buckets: { all: { transpose: 12 } } },
        { id: "d", when: "default", buckets: {} },
      ],
    });
    const h = harness(t);
    expect(fmtAll(h.feed(noteOn(60, 100)))).toEqual(["on:ch0:60@100"]);
    h.feed(cc(11, 127)); // pedal pressed mid-note
    const at = h.feed(ev({ kind: "aftertouch", note: 60, pressure: 50 }));
    expect(at).toHaveLength(1);
    expect((at[0] as Extract<MidiEvent, { kind: "aftertouch" }>).note).toBe(60);
  });
});

describe("ccRemap CC -> note", () => {
  it("flush releases the note that was started, stamped with the flush time", () => {
    resetClock();
    const h = harness(
      createCcRemap({
        id: "c",
        type: "ccRemap",
        enabled: true,
        rules: [{ id: "a:b", fromController: 64, to: { kind: "note", note: 36, channel: 9 } }],
      }),
    );
    expect(fmtAll(h.feed(cc(64, 127)))).toEqual(["on:ch9:36@127"]);
    h.ctx.now = 1234;
    const offs = h.flush();
    expect(fmtAll(offs)).toEqual(["off:ch9:36"]);
    expect(offs[0]!.t).toBe(1234);
    expect(h.flush()).toEqual([]);
  });
});

describe("parsePreset", () => {
  it("does not mutate its input", () => {
    const raw = { name: "x", ports: [], routes: [], noteNames: {} };
    parsePreset(raw);
    expect(raw).not.toHaveProperty("schemaVersion");
  });
});
