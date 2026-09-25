import type { OutputSpec, VelocitySpec } from "@midi-gateway/engine";
import { NoteField, NumberField, Select, TextField } from "../../components/ui.js";

type OutMode = "note" | "transpose" | "mute";

function modeOf(spec: OutputSpec): OutMode {
  if (spec.mute) return "mute";
  if (spec.note !== undefined) return "note";
  return "transpose";
}

const channelOptions = [
  { value: -1, label: "keep ch" },
  ...Array.from({ length: 16 }, (_, i) => ({ value: i, label: `ch ${i + 1}` })),
];

export function velocityLabel(v?: VelocitySpec): string {
  if (!v || v.mode === "passthrough") return "keep";
  if (v.mode === "fixed") return `= ${v.value}`;
  if (v.mode === "scale") return `${v.min}–${v.max}`;
  if (v.mode === "curve") return `${v.shape}`;
  return "points";
}

function VelocityMini({ value, onChange }: { value: VelocitySpec | undefined; onChange: (v: VelocitySpec | undefined) => void }) {
  const mode = value?.mode ?? "passthrough";
  return (
    <span className="flex items-center gap-1">
      <Select
        value={mode}
        onChange={(m) => {
          if (m === "passthrough") return onChange(undefined);
          if (m === "fixed") return onChange({ mode: "fixed", value: 100 });
          if (m === "scale") return onChange({ mode: "scale", min: 1, max: 127 });
          if (m === "curve") return onChange({ mode: "curve", shape: "sCurve", amount: 0.5 });
        }}
        options={[
          { value: "passthrough", label: "vel: keep" },
          { value: "fixed", label: "vel: fixed" },
          { value: "scale", label: "vel: scale" },
          { value: "curve", label: "vel: curve" },
          // Breakpoint curves come from preset files; show them instead of a wrong mode.
          ...(mode === "points" ? [{ value: "points" as const, label: "vel: points" }] : []),
        ]}
      />
      {value?.mode === "fixed" && (
        <NumberField value={value.value} min={1} max={127} onChange={(n) => onChange({ mode: "fixed", value: n })} />
      )}
      {value?.mode === "scale" && (
        <>
          <NumberField value={value.min} min={1} max={127} onChange={(n) => onChange({ ...value, min: n })} />
          <NumberField value={value.max} min={1} max={127} onChange={(n) => onChange({ ...value, max: n })} />
        </>
      )}
      {value?.mode === "curve" && (
        <>
          <Select
            value={value.shape}
            onChange={(shape) => onChange({ ...value, shape })}
            options={[
              { value: "linear", label: "linear" },
              { value: "exp", label: "exp" },
              { value: "log", label: "log" },
              { value: "sCurve", label: "S" },
            ]}
          />
          <NumberField
            value={value.amount ?? 0.5}
            min={0}
            max={1}
            step={0.1}
            onChange={(n) => onChange({ ...value, amount: n })}
          />
        </>
      )}
    </span>
  );
}

export function OutputSpecEditor({ spec, onChange }: { spec: OutputSpec; onChange: (s: OutputSpec) => void }) {
  const mode = modeOf(spec);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select
        value={mode}
        onChange={(m: OutMode) => {
          if (m === "mute") onChange({ mute: true, name: spec.name });
          else if (m === "note") onChange({ note: spec.note ?? 60, channel: spec.channel, velocity: spec.velocity, name: spec.name });
          else onChange({ transpose: spec.transpose ?? 0, channel: spec.channel, velocity: spec.velocity, name: spec.name });
        }}
        options={[
          { value: "note", label: "→ note" },
          { value: "transpose", label: "transpose" },
          { value: "mute", label: "mute" },
        ]}
      />
      {mode === "note" && <NoteField value={spec.note ?? 60} onChange={(n) => onChange({ ...spec, note: n, mute: undefined })} />}
      {mode === "transpose" && (
        <NumberField
          value={spec.transpose ?? 0}
          min={-48}
          max={48}
          suffix="st"
          onChange={(n) => onChange({ ...spec, transpose: n, mute: undefined })}
        />
      )}
      {mode !== "mute" && (
        <>
          <Select
            value={spec.channel ?? -1}
            onChange={(c) => onChange({ ...spec, channel: c === -1 ? undefined : c })}
            options={channelOptions}
          />
          <VelocityMini value={spec.velocity} onChange={(v) => onChange({ ...spec, velocity: v })} />
        </>
      )}
      <TextField value={spec.name ?? ""} placeholder="label" onChange={(name) => onChange({ ...spec, name: name || undefined })} />
    </div>
  );
}
