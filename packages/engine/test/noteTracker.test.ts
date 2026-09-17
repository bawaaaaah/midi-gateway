import { describe, expect, it } from "vitest";
import { NoteTracker } from "../src/noteTracker.js";

describe("NoteTracker", () => {
  it("pairs note-off with the exact output the note-on produced", () => {
    const t = new NoteTracker();
    expect(t.noteOn(0, 60, { channel: 2, note: 72 })).toEqual({ emit: true });
    const off = t.noteOff(0, 60);
    expect(off).toEqual({ out: { channel: 2, note: 72 }, emit: true });
  });

  it("ref-counts folded notes: sounds once, stops on last release", () => {
    const t = new NoteTracker();
    const out = { channel: 0, note: 40 };
    expect(t.noteOn(0, 60, out).emit).toBe(true); // C0..fold -> 40, first sounds
    expect(t.noteOn(0, 62, out).emit).toBe(false); // D0 folds to same, no new note-on
    expect(t.noteOn(0, 64, out).emit).toBe(false);

    expect(t.noteOff(0, 62)!.emit).toBe(false);
    expect(t.noteOff(0, 64)!.emit).toBe(false);
    expect(t.noteOff(0, 60)!.emit).toBe(true); // last release -> note-off
  });

  it("releases the old output when a held key is retriggered onto a new output", () => {
    const t = new NoteTracker();
    t.noteOn(0, 60, { channel: 0, note: 72 });
    const res = t.noteOn(0, 60, { channel: 0, note: 71 }); // mapping changed under held key
    expect(res.releaseFirst).toEqual({ channel: 0, note: 72 });
    expect(res.emit).toBe(true);
  });

  it("lists active outputs for panic", () => {
    const t = new NoteTracker();
    t.noteOn(0, 60, { channel: 0, note: 60 });
    t.noteOn(0, 64, { channel: 0, note: 64 });
    expect(t.activeOutputs()).toHaveLength(2);
    t.clear();
    expect(t.activeOutputs()).toHaveLength(0);
  });
});
