import { describe, expect, it } from "vitest";
import { parse, serialize, noteName, parseNoteName, pitchClass } from "../src/event.js";

describe("event parse/serialize", () => {
  it("round-trips note on/off", () => {
    expect(parse([0x90, 60, 100])).toMatchObject({ kind: "noteOn", channel: 0, note: 60, velocity: 100 });
    expect(parse([0x85, 62, 40])).toMatchObject({ kind: "noteOff", channel: 5, note: 62, velocity: 40 });
  });

  it("treats note-on velocity 0 as note-off", () => {
    expect(parse([0x90, 60, 0])).toMatchObject({ kind: "noteOff", note: 60, velocity: 0 });
  });

  it("parses CC, pitch bend, program, aftertouch", () => {
    expect(parse([0xb2, 11, 64])).toMatchObject({ kind: "cc", channel: 2, controller: 11, value: 64 });
    expect(parse([0xe0, 0x00, 0x40])).toMatchObject({ kind: "pitchBend", value: 8192 });
    expect(parse([0xc3, 7])).toMatchObject({ kind: "program", channel: 3, program: 7 });
    expect(parse([0xd0, 90])).toMatchObject({ kind: "aftertouch", pressure: 90 });
    expect(parse([0xa0, 60, 80])).toMatchObject({ kind: "aftertouch", note: 60, pressure: 80 });
  });

  it("serialize is the inverse of parse", () => {
    for (const bytes of [
      [0x90, 60, 100],
      [0x81, 62, 0],
      [0xb0, 1, 127],
      [0xe4, 0x7f, 0x3f],
      [0xc0, 12],
    ]) {
      expect(serialize(parse(bytes))).toEqual(bytes);
    }
  });

  it("passes unknown / sysex through as raw", () => {
    const sysex = [0xf0, 0x7e, 0x00, 0x06, 0x01, 0xf7];
    expect(parse(sysex)).toMatchObject({ kind: "raw", bytes: sysex });
    expect(serialize(parse(sysex))).toEqual(sysex);
  });
});

describe("note names", () => {
  it("uses C4 = 60", () => {
    expect(noteName(60)).toBe("C4");
    expect(noteName(69)).toBe("A4");
    expect(noteName(21)).toBe("A0");
    expect(pitchClass(72)).toBe(0);
  });
  it("parses names back", () => {
    expect(parseNoteName("C4")).toBe(60);
    expect(parseNoteName("A0")).toBe(21);
    expect(parseNoteName("F#3")).toBe(54);
    expect(parseNoteName("Bb3")).toBe(58);
    expect(parseNoteName("nope")).toBeNull();
  });
});
