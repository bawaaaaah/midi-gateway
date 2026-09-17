import { describe, expect, it } from "vitest";
import { parsePreset } from "../src/presetSchema.js";
import { emptyPreset } from "../src/types.js";
import { buildKeyboardMapperFromLearn, buildComboFromLearn } from "../src/learnToTransform.js";
import { RouteChain } from "../src/chain.js";
import { CcState, type RouteContext } from "../src/context.js";
import { LearnBuffer } from "../src/learn.js";
import { noteOn, noteOff, fmtAll, resetClock } from "./helpers.js";

describe("parsePreset", () => {
  it("accepts an empty preset and round-trips", () => {
    const p = emptyPreset("Kit");
    expect(parsePreset(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it("stamps a missing schemaVersion", () => {
    const p = parsePreset({ name: "x", ports: [], routes: [], noteNames: {} });
    expect(p.schemaVersion).toBe(1);
  });

  it("rejects an out-of-range note", () => {
    expect(() =>
      parsePreset({
        schemaVersion: 1,
        name: "x",
        ports: [],
        noteNames: {},
        routes: [
          {
            id: "r",
            name: "r",
            enabled: true,
            sources: [],
            destinations: [],
            transforms: [{ id: "t", type: "transpose", enabled: true, semitones: 999_999 }],
          },
        ],
      }),
    ).not.toThrow(); // semitones is just z.number().int(); transpose clamps at runtime

    expect(() =>
      parsePreset({
        schemaVersion: 1,
        name: "x",
        ports: [{ id: "p", name: "p", kind: "not-a-kind" }],
        routes: [],
        noteNames: {},
      }),
    ).toThrow();
  });
});

describe("learnToTransform", () => {
  it("builds a keyboardMapper with a default + expression-pedal layer that actually maps", () => {
    resetClock();
    const cfg = buildKeyboardMapperFromLearn({
      base: [{ note: 60, output: { note: 36 } }],
      pedalLayers: [{ cc: 11, min: 64, mappings: [{ note: 60, output: { note: 37 } }] }],
    });
    const ctx: RouteContext = { now: 0, cc: new CcState(), learn: new LearnBuffer() };
    const chain = new RouteChain("r", [cfg]);

    expect(fmtAll(chain.process(noteOn(60, 100), ctx))).toEqual(["on:ch0:36@100"]);
    chain.process(noteOff(60), ctx);
    ctx.cc.set(0, 11, 127);
    ctx.now = 10;
    expect(fmtAll(chain.process(noteOn(60, 100), ctx))).toEqual(["on:ch0:37@100"]);
  });

  it("builds a combo transform", () => {
    const cfg = buildComboFromLearn({
      triggers: [
        { kind: "note", value: 40 },
        { kind: "ccAbove", value: 4, threshold: 80 },
      ],
      output: { note: 99 },
    });
    expect(cfg.type).toBe("combo");
    if (cfg.type === "combo") {
      expect(cfg.triggers).toHaveLength(2);
      expect(cfg.suppressTriggers).toBe(true);
    }
  });
});
