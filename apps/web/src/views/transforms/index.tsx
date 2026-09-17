import type { TransformConfig } from "@midi-gateway/engine";
import { KeyboardMapperEditor } from "./KeyboardMapperEditor.js";
import { ComboEditor } from "./ComboEditor.js";
import { ChannelRemapEditor, CcRemapEditor, FilterEditor, TransposeEditor, VelocityEditor } from "./SimpleEditors.js";

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`;

export const TRANSFORM_LABELS: Record<TransformConfig["type"], string> = {
  keyboardMapper: "Keyboard mapper",
  combo: "Combo",
  channelRemap: "Channel remap",
  transpose: "Transpose",
  velocity: "Velocity",
  filter: "Filter",
  ccRemap: "CC remap",
  learnTap: "Learn tap",
};

export const TRANSFORM_HINTS: Record<TransformConfig["type"], string> = {
  keyboardMapper: "Group / split the keyboard, remap drums, hi-hat by pedal, expression-pedal layers",
  combo: "Fire one note when several notes / CCs happen together",
  channelRemap: "Move events between MIDI channels",
  transpose: "Shift every note by N semitones",
  velocity: "Reshape note-on velocity",
  filter: "Drop or keep events by type / note range",
  ccRemap: "Turn a CC into another CC, a note, or nothing",
  learnTap: "Feed the learn table from this point in the chain",
};

export function newTransform(type: TransformConfig["type"]): TransformConfig {
  const base = { id: uid(type), enabled: true } as const;
  switch (type) {
    case "keyboardMapper":
      return {
        ...base,
        type,
        partition: { mode: "byPitchClass" },
        layers: [{ id: uid("layer"), when: "default", buckets: {} }],
      };
    case "combo":
      return {
        ...base,
        type,
        windowMs: 30,
        triggers: [{ id: uid("trig"), kind: "note", value: 38 }],
        output: { note: 99 },
        suppressTriggers: true,
      };
    case "channelRemap":
      return { ...base, type, map: {} };
    case "transpose":
      return { ...base, type, semitones: 12 };
    case "velocity":
      return { ...base, type, spec: { mode: "curve", shape: "sCurve", amount: 0.5 } };
    case "filter":
      return { ...base, type, action: "drop", match: { kinds: ["aftertouch"] } };
    case "ccRemap":
      return { ...base, type, rules: [] };
    case "learnTap":
      return { ...base, type };
  }
}

export function TransformEditor({
  config,
  onChange,
}: {
  config: TransformConfig;
  onChange: (c: TransformConfig) => void;
}) {
  switch (config.type) {
    case "keyboardMapper":
      return <KeyboardMapperEditor config={config} onChange={onChange} />;
    case "combo":
      return <ComboEditor config={config} onChange={onChange} />;
    case "channelRemap":
      return <ChannelRemapEditor config={config} onChange={onChange} />;
    case "transpose":
      return <TransposeEditor config={config} onChange={onChange} />;
    case "velocity":
      return <VelocityEditor config={config} onChange={onChange} />;
    case "filter":
      return <FilterEditor config={config} onChange={onChange} />;
    case "ccRemap":
      return <CcRemapEditor config={config} onChange={onChange} />;
    case "learnTap":
      return <p className="text-[12px] text-muted">No settings — this just samples events into the Learn table.</p>;
  }
}
