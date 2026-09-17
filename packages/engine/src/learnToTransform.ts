/**
 * Turn a set of learned notes + user choices into a ready-to-insert
 * {@link TransformConfig}. This is the "mass edit" / "create mapping from
 * selection" logic behind the Learn view.
 */
import type { ComboTrigger, Layer, OutputSpec, TransformConfig } from "./types.js";

let counter = 0;
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${(counter++).toString(36)}`;

export interface NoteMapping {
  /** Incoming note number. */
  note: number;
  /** What it should become. */
  output: OutputSpec;
}

export interface PedalLayerSpec {
  cc: number;
  min?: number;
  max?: number;
  channel?: number;
  /** Outputs to use for the same notes while the pedal condition holds. */
  mappings: NoteMapping[];
  label?: string;
}

export interface BuildKeyboardMapperOptions {
  label?: string;
  channels?: number[];
  /** Base (pedal released) mappings. */
  base: NoteMapping[];
  /** Zero or more CC-conditioned layers (expression pedal, hi-hat pedal ranges...). */
  pedalLayers?: PedalLayerSpec[];
}

/**
 * Build a `keyboardMapper` using an `explicitList` partition - one bucket per
 * distinct incoming note - a `default` layer from `base`, and one extra layer
 * per {@link PedalLayerSpec}. Covers "these drums map like this", the hi-hat
 * open/half/closed case, and the piano "note + expression pedal" case.
 */
export function buildKeyboardMapperFromLearn(opts: BuildKeyboardMapperOptions): TransformConfig {
  const notes = new Set<number>();
  for (const m of opts.base) notes.add(m.note);
  for (const pl of opts.pedalLayers ?? []) for (const m of pl.mappings) notes.add(m.note);

  const bucketId = (note: number) => `n${note}`;
  const groups = [...notes].sort((a, b) => a - b).map((note) => ({ id: bucketId(note), notes: [note] }));

  const defaultLayer: Layer = {
    id: uid("layer"),
    when: "default",
    buckets: Object.fromEntries(opts.base.map((m) => [bucketId(m.note), m.output])),
  };

  const pedalLayers: Layer[] = (opts.pedalLayers ?? []).map((pl) => ({
    id: uid("layer"),
    when: { cc: pl.cc, min: pl.min, max: pl.max, channel: pl.channel },
    buckets: Object.fromEntries(pl.mappings.map((m) => [bucketId(m.note), m.output])),
  }));

  return {
    id: uid("kbm"),
    type: "keyboardMapper",
    enabled: true,
    label: opts.label ?? "Mapping from learn",
    channels: opts.channels,
    partition: { mode: "explicitList", groups },
    // Condition layers first so an active pedal layer wins over `default`.
    layers: [...pedalLayers, defaultLayer],
  };
}

export interface BuildComboOptions {
  label?: string;
  windowMs?: number;
  triggers: Omit<ComboTrigger, "id">[];
  output: OutputSpec & { channel?: number };
  suppressTriggers?: boolean;
}

/** Build a `combo` transform from a set of trigger notes/CCs. */
export function buildComboFromLearn(opts: BuildComboOptions): TransformConfig {
  return {
    id: uid("combo"),
    type: "combo",
    enabled: true,
    label: opts.label ?? "Combo from learn",
    windowMs: opts.windowMs ?? 30,
    triggers: opts.triggers.map((t) => ({ ...t, id: uid("trig") })),
    output: opts.output,
    suppressTriggers: opts.suppressTriggers ?? true,
  };
}
