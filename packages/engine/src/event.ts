/**
 * Conversion between raw MIDI byte messages and the normalised {@link MidiEvent}.
 *
 * `parse` accepts a single complete MIDI message (as produced by RtMidi /
 * Web MIDI - one message per callback). `serialize` produces the bytes for a
 * single event. System real-time / sysex and anything unrecognised round-trips
 * through the `raw` kind untouched.
 */
import type { MidiEvent, MidiEventBase } from "./types.js";

const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const POLY_AFTERTOUCH = 0xa0;
const CONTROL_CHANGE = 0xb0;
const PROGRAM_CHANGE = 0xc0;
const CHANNEL_AFTERTOUCH = 0xd0;
const PITCH_BEND = 0xe0;

export interface ParseMeta {
  t?: number;
  sourceId?: string;
}

function base(meta: ParseMeta): MidiEventBase {
  return { t: meta.t ?? 0, sourceId: meta.sourceId ?? "" };
}

export function parse(bytes: number[] | Uint8Array, meta: ParseMeta = {}): MidiEvent {
  const b = Array.from(bytes);
  const status = b[0] ?? 0;
  const type = status & 0xf0;
  const channel = status & 0x0f;

  switch (type) {
    case NOTE_ON: {
      const note = b[1] ?? 0;
      const velocity = b[2] ?? 0;
      // Running-status convention: note-on with velocity 0 is a note-off.
      if (velocity === 0) {
        return { ...base(meta), kind: "noteOff", channel, note, velocity: 0 };
      }
      return { ...base(meta), kind: "noteOn", channel, note, velocity };
    }
    case NOTE_OFF:
      return { ...base(meta), kind: "noteOff", channel, note: b[1] ?? 0, velocity: b[2] ?? 0 };
    case CONTROL_CHANGE:
      return { ...base(meta), kind: "cc", channel, controller: b[1] ?? 0, value: b[2] ?? 0 };
    case PITCH_BEND:
      return {
        ...base(meta),
        kind: "pitchBend",
        channel,
        value: ((b[2] ?? 0) << 7) | (b[1] ?? 0),
      };
    case CHANNEL_AFTERTOUCH:
      return { ...base(meta), kind: "aftertouch", channel, pressure: b[1] ?? 0 };
    case POLY_AFTERTOUCH:
      return {
        ...base(meta),
        kind: "aftertouch",
        channel,
        pressure: b[2] ?? 0,
        note: b[1] ?? 0,
      };
    case PROGRAM_CHANGE:
      return { ...base(meta), kind: "program", channel, program: b[1] ?? 0 };
    default:
      return { ...base(meta), kind: "raw", bytes: b };
  }
}

export function serialize(ev: MidiEvent): number[] {
  switch (ev.kind) {
    case "noteOn":
      return [NOTE_ON | (ev.channel & 0x0f), clamp7(ev.note), clamp7(ev.velocity)];
    case "noteOff":
      return [NOTE_OFF | (ev.channel & 0x0f), clamp7(ev.note), clamp7(ev.velocity)];
    case "cc":
      return [CONTROL_CHANGE | (ev.channel & 0x0f), clamp7(ev.controller), clamp7(ev.value)];
    case "pitchBend": {
      const v = Math.max(0, Math.min(16383, Math.round(ev.value)));
      return [PITCH_BEND | (ev.channel & 0x0f), v & 0x7f, (v >> 7) & 0x7f];
    }
    case "aftertouch":
      return ev.note === undefined
        ? [CHANNEL_AFTERTOUCH | (ev.channel & 0x0f), clamp7(ev.pressure)]
        : [POLY_AFTERTOUCH | (ev.channel & 0x0f), clamp7(ev.note), clamp7(ev.pressure)];
    case "program":
      return [PROGRAM_CHANGE | (ev.channel & 0x0f), clamp7(ev.program)];
    case "raw":
      return [...ev.bytes];
  }
}

export function clamp7(n: number): number {
  return Math.max(0, Math.min(127, Math.round(n)));
}

export function clampChannel(n: number): number {
  return Math.max(0, Math.min(15, Math.round(n)));
}

// ---------------------------------------------------------------------------
// Note name helpers (C4 = MIDI 60, "scientific pitch notation")
// ---------------------------------------------------------------------------

const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function noteName(note: number, { octaveOffset = -1 }: { octaveOffset?: number } = {}): string {
  const pc = ((note % 12) + 12) % 12;
  const octave = Math.floor(note / 12) + octaveOffset;
  return `${PITCH_NAMES[pc]}${octave}`;
}

export function pitchClass(note: number): number {
  return ((note % 12) + 12) % 12;
}

/** Parse "C4", "F#3", "Bb2" back into a MIDI note number (C4 = 60). */
export function parseNoteName(name: string, { octaveOffset = -1 }: { octaveOffset?: number } = {}): number | null {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(name.trim());
  if (!m) return null;
  const letter = m[1]!.toUpperCase();
  const accidental = m[2];
  const octave = parseInt(m[3]!, 10);
  const baseByLetter: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let pc = baseByLetter[letter]!;
  if (accidental === "#") pc += 1;
  if (accidental === "b") pc -= 1;
  const note = (octave - octaveOffset) * 12 + pc;
  return note >= 0 && note <= 127 ? note : null;
}
