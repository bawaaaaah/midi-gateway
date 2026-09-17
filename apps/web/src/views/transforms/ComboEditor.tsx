import type { ComboTrigger, TransformConfig } from "@midi-gateway/engine";
import { noteName } from "@midi-gateway/engine";
import { Btn, Field, NoteField, NumberField, Select, Toggle } from "../../components/ui.js";
import { OutputSpecEditor } from "./OutputSpecEditor.js";

type Cfg = Extract<TransformConfig, { type: "combo" }>;
const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`;

function TriggerRow({ tr, onChange, onDelete }: { tr: ComboTrigger; onChange: (t: ComboTrigger) => void; onDelete: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-line/60 px-2 py-1">
      <Select
        value={tr.kind}
        onChange={(kind) => onChange({ ...tr, kind })}
        options={[
          { value: "note", label: "Note held" },
          { value: "ccAbove", label: "CC ≥ threshold" },
          { value: "ccBelow", label: "CC ≤ threshold" },
        ]}
      />
      {tr.kind === "note" ? (
        <NoteField value={tr.value} onChange={(value) => onChange({ ...tr, value })} />
      ) : (
        <>
          <span className="text-[11px] text-muted">CC</span>
          <NumberField value={tr.value} min={0} max={127} onChange={(value) => onChange({ ...tr, value })} />
          <span className="text-[11px] text-muted">thr</span>
          <NumberField value={tr.threshold ?? 64} min={0} max={127} onChange={(threshold) => onChange({ ...tr, threshold })} />
        </>
      )}
      <Btn size="sm" variant="ghost" onClick={onDelete}>
        ✕
      </Btn>
    </div>
  );
}

export function ComboEditor({ config, onChange }: { config: Cfg; onChange: (c: Cfg) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Window" hint="max time between triggers">
          <NumberField value={config.windowMs} min={1} max={500} suffix="ms" onChange={(windowMs) => onChange({ ...config, windowMs })} />
        </Field>
        <Field label="Suppress triggers" hint="hide the individual notes">
          <Toggle checked={config.suppressTriggers} onChange={(suppressTriggers) => onChange({ ...config, suppressTriggers })} />
        </Field>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-wide text-muted">Triggers (all must be active)</span>
        {config.triggers.map((tr) => (
          <TriggerRow
            key={tr.id}
            tr={tr}
            onChange={(t) => onChange({ ...config, triggers: config.triggers.map((x) => (x.id === t.id ? t : x)) })}
            onDelete={() => onChange({ ...config, triggers: config.triggers.filter((x) => x.id !== tr.id) })}
          />
        ))}
        <Btn
          size="sm"
          onClick={() => onChange({ ...config, triggers: [...config.triggers, { id: uid("trig"), kind: "note", value: 38 }] })}
        >
          + trigger
        </Btn>
      </div>

      <Field label={`Emits ${config.output.note !== undefined ? noteName(config.output.note) : "note"}`}>
        <OutputSpecEditor spec={config.output} onChange={(output) => onChange({ ...config, output })} />
      </Field>
    </div>
  );
}
