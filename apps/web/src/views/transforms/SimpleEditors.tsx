import type { TransformConfig } from "@midi-gateway/engine";
import { noteName } from "@midi-gateway/engine";
import { Btn, Field, NoteField, NumberField, Select, TextField, Toggle } from "../../components/ui.js";

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`;
const chOpts = [
  { value: -1, label: "keep" },
  ...Array.from({ length: 16 }, (_, i) => ({ value: i, label: `ch ${i + 1}` })),
];

export function ChannelRemapEditor({
  config,
  onChange,
}: {
  config: Extract<TransformConfig, { type: "channelRemap" }>;
  onChange: (c: Extract<TransformConfig, { type: "channelRemap" }>) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {Array.from({ length: 16 }, (_, i) => (
        <label key={i} className="flex items-center gap-1 text-[11px]">
          <span className="w-8 text-muted">ch {i + 1}</span>
          <span className="text-muted">→</span>
          <Select
            value={config.map[i] ?? -1}
            onChange={(v) => {
              const map = { ...config.map };
              if (v === -1 || v === i) delete map[i];
              else map[i] = v;
              onChange({ ...config, map });
            }}
            options={chOpts}
          />
        </label>
      ))}
    </div>
  );
}

export function TransposeEditor({
  config,
  onChange,
}: {
  config: Extract<TransformConfig, { type: "transpose" }>;
  onChange: (c: Extract<TransformConfig, { type: "transpose" }>) => void;
}) {
  return (
    <div className="flex items-end gap-3">
      <Field label="Semitones">
        <NumberField value={config.semitones} min={-48} max={48} onChange={(semitones) => onChange({ ...config, semitones })} />
      </Field>
      <Field label="Wrap octaves" hint="fold out-of-range notes back in">
        <Toggle checked={config.wrap ?? false} onChange={(wrap) => onChange({ ...config, wrap })} />
      </Field>
    </div>
  );
}

export function VelocityEditor({
  config,
  onChange,
}: {
  config: Extract<TransformConfig, { type: "velocity" }>;
  onChange: (c: Extract<TransformConfig, { type: "velocity" }>) => void;
}) {
  const spec = config.spec;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Mode">
        <Select
          value={spec.mode}
          onChange={(mode) => {
            if (mode === "passthrough") onChange({ ...config, spec: { mode: "passthrough" } });
            else if (mode === "fixed") onChange({ ...config, spec: { mode: "fixed", value: 100 } });
            else if (mode === "scale") onChange({ ...config, spec: { mode: "scale", min: 1, max: 127 } });
            else onChange({ ...config, spec: { mode: "curve", shape: "sCurve", amount: 0.5 } });
          }}
          options={[
            { value: "passthrough", label: "passthrough" },
            { value: "fixed", label: "fixed" },
            { value: "scale", label: "scale" },
            { value: "curve", label: "curve" },
          ]}
        />
      </Field>
      {spec.mode === "fixed" && (
        <Field label="Value">
          <NumberField value={spec.value} min={1} max={127} onChange={(value) => onChange({ ...config, spec: { mode: "fixed", value } })} />
        </Field>
      )}
      {spec.mode === "scale" && (
        <>
          <Field label="Min">
            <NumberField value={spec.min} min={1} max={127} onChange={(min) => onChange({ ...config, spec: { ...spec, min } })} />
          </Field>
          <Field label="Max">
            <NumberField value={spec.max} min={1} max={127} onChange={(max) => onChange({ ...config, spec: { ...spec, max } })} />
          </Field>
        </>
      )}
      {spec.mode === "curve" && (
        <>
          <Field label="Shape">
            <Select
              value={spec.shape}
              onChange={(shape) => onChange({ ...config, spec: { ...spec, shape } })}
              options={[
                { value: "linear", label: "linear" },
                { value: "exp", label: "exp (soft)" },
                { value: "log", label: "log (hot)" },
                { value: "sCurve", label: "S-curve" },
              ]}
            />
          </Field>
          <Field label="Amount">
            <NumberField value={spec.amount ?? 0.5} min={0} max={1} step={0.1} onChange={(amount) => onChange({ ...config, spec: { ...spec, amount } })} />
          </Field>
        </>
      )}
    </div>
  );
}

export function FilterEditor({
  config,
  onChange,
}: {
  config: Extract<TransformConfig, { type: "filter" }>;
  onChange: (c: Extract<TransformConfig, { type: "filter" }>) => void;
}) {
  const m = config.match;
  const kinds = ["noteOn", "noteOff", "cc", "pitchBend", "aftertouch", "program"] as const;
  return (
    <div className="flex flex-col gap-2">
      <Field label="Action">
        <Select
          value={config.action}
          onChange={(action) => onChange({ ...config, action })}
          options={[
            { value: "drop", label: "Drop matching" },
            { value: "keep", label: "Keep only matching" },
          ]}
        />
      </Field>
      <div className="flex flex-wrap gap-1">
        {kinds.map((k) => {
          const on = m.kinds?.includes(k) ?? false;
          return (
            <button
              key={k}
              onClick={() => {
                const set = new Set(m.kinds ?? []);
                on ? set.delete(k) : set.add(k);
                onChange({ ...config, match: { ...m, kinds: [...set] } });
              }}
              className={`rounded border px-1.5 py-0.5 text-[11px] ${on ? "border-accent text-accent" : "border-line text-muted"}`}
            >
              {k}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3">
        <Field label="Note ≥">
          <NoteField value={m.noteMin ?? 0} onChange={(noteMin) => onChange({ ...config, match: { ...m, noteMin } })} />
        </Field>
        <Field label="Note ≤">
          <NoteField value={m.noteMax ?? 127} onChange={(noteMax) => onChange({ ...config, match: { ...m, noteMax } })} />
        </Field>
      </div>
    </div>
  );
}

export function CcRemapEditor({
  config,
  onChange,
}: {
  config: Extract<TransformConfig, { type: "ccRemap" }>;
  onChange: (c: Extract<TransformConfig, { type: "ccRemap" }>) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {config.rules.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-2 rounded border border-line/60 px-2 py-1 text-[11px]">
          <span className="text-muted">CC</span>
          <NumberField
            value={r.fromController}
            min={0}
            max={127}
            onChange={(fromController) => onChange({ ...config, rules: config.rules.map((x) => (x.id === r.id ? { ...x, fromController } : x)) })}
          />
          <span className="text-muted">→</span>
          <Select
            value={r.to.kind}
            onChange={(kind) => {
              const to = kind === "cc" ? { kind: "cc" as const, controller: 1 } : kind === "note" ? { kind: "note" as const, note: 60 } : { kind: "drop" as const };
              onChange({ ...config, rules: config.rules.map((x) => (x.id === r.id ? { ...x, to } : x)) });
            }}
            options={[
              { value: "cc", label: "CC" },
              { value: "note", label: "Note" },
              { value: "drop", label: "Drop" },
            ]}
          />
          {r.to.kind === "cc" && (
            <NumberField
              value={r.to.controller}
              min={0}
              max={127}
              onChange={(controller) =>
                onChange({ ...config, rules: config.rules.map((x) => (x.id === r.id ? { ...x, to: { ...r.to, kind: "cc", controller } } : x)) })
              }
            />
          )}
          {r.to.kind === "note" && (
            <NoteField
              value={r.to.note}
              onChange={(note) =>
                onChange({ ...config, rules: config.rules.map((x) => (x.id === r.id ? { ...x, to: { kind: "note", note } } : x)) })
              }
            />
          )}
          <Btn size="sm" variant="ghost" onClick={() => onChange({ ...config, rules: config.rules.filter((x) => x.id !== r.id) })}>
            ✕
          </Btn>
        </div>
      ))}
      <Btn size="sm" onClick={() => onChange({ ...config, rules: [...config.rules, { id: uid("rule"), fromController: 1, to: { kind: "cc", controller: 11 } }] })}>
        + rule
      </Btn>
    </div>
  );
}

export { noteName };
