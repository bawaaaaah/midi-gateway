/**
 * Core domain types for the MIDI gateway engine.
 *
 * The engine is pure: it never touches real MIDI ports, sockets or the
 * filesystem. It only turns {@link MidiEvent}s into other {@link MidiEvent}s
 * according to a {@link Preset}.
 *
 * Conventions:
 * - `channel` is 0-based (0..15). The web UI displays it 1-based.
 * - `note`, `velocity`, `controller`, `value`, `program` are 0..127.
 * - `pitchBend.value` is 0..16383 (centre = 8192).
 */

export type Channel = number; // 0..15
export type Note = number; // 0..127
export type U7 = number; // 0..127
export type U14 = number; // 0..16383

export interface MidiEventBase {
  /** Monotonic timestamp in milliseconds, stamped by the router on ingress. */
  t: number;
  /** Id of the port the event entered through. Empty for engine-generated events. */
  sourceId: string;
}

export type MidiEvent =
  | (MidiEventBase & { kind: "noteOn"; channel: Channel; note: Note; velocity: U7 })
  | (MidiEventBase & { kind: "noteOff"; channel: Channel; note: Note; velocity: U7 })
  | (MidiEventBase & { kind: "cc"; channel: Channel; controller: U7; value: U7 })
  | (MidiEventBase & { kind: "pitchBend"; channel: Channel; value: U14 })
  | (MidiEventBase & { kind: "aftertouch"; channel: Channel; pressure: U7; note?: Note })
  | (MidiEventBase & { kind: "program"; channel: Channel; program: U7 })
  | (MidiEventBase & { kind: "raw"; bytes: number[] });

export type MidiEventKind = MidiEvent["kind"];

/** A note-bearing event (note on/off). Handy for the note tracker. */
export type NoteEvent = Extract<MidiEvent, { kind: "noteOn" | "noteOff" }>;

// ---------------------------------------------------------------------------
// Ports & routes
// ---------------------------------------------------------------------------

export type PortId = string;
export type RouteId = string;

export type PortKind =
  | "hw-in"
  | "hw-out"
  | "virtual-in"
  | "virtual-out"
  | "rtp"; // bidirectional network session

export interface Port {
  id: PortId;
  /** User-facing name (editable, persisted in the preset). */
  name: string;
  kind: PortKind;
  /** For hw-* ports: the name reported by the OS, used to re-bind on reconnect. */
  systemName?: string;
  /** For rtp ports: connection details. */
  rtp?: RtpSessionConfig;
}

export interface RtpSessionConfig {
  /** Bonjour service name to advertise / look for. */
  sessionName: string;
  /** Local UDP control port (data port is control + 1). */
  localPort: number;
  mode: "listener" | "initiator";
  /** Only for `initiator`: where to connect. */
  remoteHost?: string;
  remotePort?: number;
}

export interface Route {
  id: RouteId;
  name: string;
  enabled: boolean;
  sources: PortId[];
  destinations: PortId[];
  transforms: TransformConfig[];
}

// ---------------------------------------------------------------------------
// Velocity
// ---------------------------------------------------------------------------

export type VelocityCurveShape = "linear" | "exp" | "log" | "sCurve";

export type VelocitySpec =
  | { mode: "passthrough" }
  | { mode: "fixed"; value: U7 }
  | { mode: "scale"; min: U7; max: U7 }
  | { mode: "curve"; shape: VelocityCurveShape; amount?: number } // amount 0..1, default 0.5
  | { mode: "points"; points: [number, number][] }; // piecewise linear, x/y in 0..127

// ---------------------------------------------------------------------------
// keyboardMapper
// ---------------------------------------------------------------------------

export interface OutputSpec {
  /** Absolute output note. Mutually exclusive with `transpose`. */
  note?: Note;
  /** Relative transposition in semitones (applied to the incoming note). */
  transpose?: number;
  /** Force a channel (0-based). Undefined = keep incoming channel. */
  channel?: Channel;
  velocity?: VelocitySpec;
  /** Optional label surfaced in the UI / monitor. */
  name?: string;
  /** Drop this note entirely (useful to silence a bucket in one layer). */
  mute?: boolean;
}

export type Partition =
  | { mode: "identity" }
  | { mode: "byPitchClass" } // buckets keyed "pc0".."pc11" (C..B)
  | {
      mode: "rangeGenerator";
      /** First note of the first zone. */
      start: Note;
      /** Zone width in semitones. */
      size: number;
      /** Number of zones. */
      count: number;
      /** Notes outside [start, start + size*count) fall in bucket "out". */
    }
  | { mode: "manualZones"; zones: Zone[] }
  | { mode: "explicitList"; groups: NoteGroup[] };

export interface Zone {
  id: string;
  /** Inclusive lower bound. */
  from: Note;
  /** Inclusive upper bound. */
  to: Note;
}

export interface NoteGroup {
  id: string;
  notes: Note[];
}

export type LayerCondition =
  | "default"
  /**
   * Active while CC `cc` is within [min, max] (each bound inclusive, optional).
   * `channel` selects which channel's CC to read; defaults to the note's channel.
   */
  | { cc: U7; min?: U7; max?: U7; channel?: Channel };

export interface Layer {
  id: string;
  when: LayerCondition;
  /** bucketId -> what to emit. Buckets absent here fall through to the next layer. */
  buckets: Record<string, OutputSpec>;
}

// ---------------------------------------------------------------------------
// Transform configs (the serializable shapes stored in a preset)
// ---------------------------------------------------------------------------

export interface TransformCommon {
  id: string;
  enabled: boolean;
  /** Optional user label. */
  label?: string;
}

export type TransformConfig =
  | (TransformCommon & { type: "channelRemap"; map: Record<string, Channel> })
  | (TransformCommon & { type: "transpose"; semitones: number; wrap?: boolean })
  | (TransformCommon & { type: "velocity"; spec: VelocitySpec; channels?: Channel[] })
  | (TransformCommon & {
      type: "filter";
      /** What to do with matching events. */
      action: "drop" | "keep";
      match: FilterMatch;
    })
  | (TransformCommon & {
      type: "ccRemap";
      rules: CcRemapRule[];
    })
  | (TransformCommon & {
      type: "keyboardMapper";
      /** Only notes in this channel set are mapped; others pass through. Empty = all. */
      channels?: Channel[];
      partition: Partition;
      layers: Layer[];
    })
  | (TransformCommon & {
      type: "combo";
      windowMs: number;
      triggers: ComboTrigger[];
      /** Emit this when all triggers fire within the window. */
      output: OutputSpec & { channel?: Channel };
      /** Swallow the individual trigger note-ons/CCs that formed the combo. */
      suppressTriggers: boolean;
    })
  | (TransformCommon & { type: "learnTap" });

export interface FilterMatch {
  kinds?: MidiEventKind[];
  channels?: Channel[];
  noteMin?: Note;
  noteMax?: Note;
  velocityMin?: U7;
  velocityMax?: U7;
  controllers?: U7[];
}

export interface CcRemapRule {
  id: string;
  fromController: U7;
  fromChannel?: Channel;
  /** Target kind. */
  to:
    | { kind: "cc"; controller: U7; channel?: Channel; invert?: boolean; scale?: [U7, U7] }
    | { kind: "note"; note: Note; channel?: Channel; threshold?: U7 } // >= threshold -> noteOn, else noteOff
    | { kind: "drop" };
}

export interface ComboTrigger {
  id: string;
  kind: "note" | "ccAbove" | "ccBelow";
  /** For `note`: the note number. For cc*: the controller number. */
  value: U7;
  /** For cc* triggers: the threshold. */
  threshold?: U7;
  channel?: Channel;
}

// ---------------------------------------------------------------------------
// Preset
// ---------------------------------------------------------------------------

export const PRESET_SCHEMA_VERSION = 1 as const;

export interface Preset {
  schemaVersion: typeof PRESET_SCHEMA_VERSION;
  name: string;
  ports: Port[];
  routes: Route[];
  /** note number -> friendly name (e.g. 36 -> "Kick"). Shared across the preset. */
  noteNames: Record<number, string>;
  /** Free-form notes for the user. */
  description?: string;
}

export function emptyPreset(name = "Untitled"): Preset {
  return {
    schemaVersion: PRESET_SCHEMA_VERSION,
    name,
    ports: [],
    routes: [],
    noteNames: {},
  };
}
