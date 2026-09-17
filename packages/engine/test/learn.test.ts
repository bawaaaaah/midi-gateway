import { describe, expect, it } from "vitest";
import { LearnBuffer } from "../src/learn.js";
import { CcState } from "../src/context.js";
import { noteOn, noteOff, cc, resetClock } from "./helpers.js";

describe("LearnBuffer", () => {
  it("aggregates hits by signature with velocity range and count", () => {
    resetClock();
    const lb = new LearnBuffer();
    lb.observe(noteOn(36, 100));
    lb.observe(noteOn(36, 60));
    lb.observe(noteOn(38, 90));

    const rows = lb.list();
    expect(rows.map((r) => r.signature)).toEqual(["noteOn:ch0:n36", "noteOn:ch0:n38"]);
    const kick = rows[0]!;
    expect(kick.count).toBe(2);
    expect(kick.velocityMin).toBe(60);
    expect(kick.velocityMax).toBe(100);
  });

  it("records the CC that is active during a hit (hi-hat pedal hint)", () => {
    resetClock();
    const lb = new LearnBuffer();
    const state = new CcState();

    state.set(0, 4, 95); // hi-hat pedal pressed
    lb.observe(noteOn(46, 120), state);
    lb.observe(noteOn(46, 110), state);

    const hh = lb.list().find((r) => r.signature === "noteOn:ch0:n46")!;
    expect(hh.concurrentCc[4]).toMatchObject({ value: 95, count: 2 });
  });

  it("clears", () => {
    const lb = new LearnBuffer();
    lb.observe(noteOff(36));
    lb.clear();
    expect(lb.list()).toEqual([]);
  });
});
