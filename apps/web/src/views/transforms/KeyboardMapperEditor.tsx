import { useMemo } from "react";
import type { Layer, OutputSpec, Partition, TransformConfig } from "@midi-gateway/engine";
import { noteName, parseNoteName } from "@midi-gateway/engine";
import { Btn, DraftTextField, Field, NoteField, NumberField, Segmented, Tag, Toggle } from "../../components/ui.js";
import { OutputSpecEditor } from "./OutputSpecEditor.js";

type Cfg = Extract<TransformConfig, { type: "keyboardMapper" }>;
const PC = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`;

interface Bucket {
  id: string;
  label: string;
}

/** "46, 42 C1 f#2" -> [46, 42, 24, 42]: numbers or note names, deduplicated, invalid tokens ignored. */
function parseNoteList(raw: string): number[] {
  const notes = raw
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map((tok) => (/^\d+$/.test(tok) ? Number(tok) : parseNoteName(tok)))
    .filter((n): n is number => n !== null && n >= 0 && n <= 127);
  return [...new Set(notes)];
}

export function bucketsForPartition(p: Partition): Bucket[] {
  switch (p.mode) {
    case "identity":
      return [{ id: "all", label: "All notes" }];
    case "byPitchClass":
      return PC.map((n, i) => ({ id: `pc${i}`, label: `${n} (every ${n})` }));
    case "rangeGenerator": {
      const out: Bucket[] = [];
      for (let i = 0; i < p.count; i++) {
        const from = p.start + i * p.size;
        out.push({ id: `z${i}`, label: `Zone ${i + 1} · ${noteName(from)}–${noteName(from + p.size - 1)}` });
      }
      out.push({ id: "out", label: "Outside range" });
      return out;
    }
    case "manualZones":
      return [
        ...p.zones.map((z) => ({ id: z.id, label: `${noteName(z.from)}–${noteName(z.to)}` })),
        { id: "out", label: "Outside zones" },
      ];
    case "explicitList":
      return [
        ...p.groups.map((g) => ({ id: g.id, label: g.notes.map((n) => noteName(n)).join(", ") || "(empty)" })),
        { id: "out", label: "Ungrouped" },
      ];
  }
}

function PartitionEditor({ partition, onChange }: { partition: Partition; onChange: (p: Partition) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Partition — how incoming notes are bucketed">
        <Segmented
          value={partition.mode}
          onChange={(mode) => {
            if (mode === partition.mode) return;
            if (mode === "identity") onChange({ mode: "identity" });
            else if (mode === "byPitchClass") onChange({ mode: "byPitchClass" });
            else if (mode === "rangeGenerator") onChange({ mode: "rangeGenerator", start: 21, size: 12, count: 4 });
            else if (mode === "manualZones") onChange({ mode: "manualZones", zones: [{ id: uid("z"), from: 21, to: 47 }] });
            else onChange({ mode: "explicitList", groups: [{ id: uid("g"), notes: [] }] });
          }}
          options={[
            { value: "identity", label: "Whole keyboard" },
            { value: "byPitchClass", label: "Group by note" },
            { value: "rangeGenerator", label: "Split every N" },
            { value: "manualZones", label: "Manual zones" },
            { value: "explicitList", label: "Explicit groups" },
          ]}
        />
      </Field>

      {partition.mode === "rangeGenerator" && (
        <div className="flex flex-wrap gap-3">
          <Field label="Start note">
            <NoteField value={partition.start} onChange={(start) => onChange({ ...partition, start })} />
          </Field>
          <Field label="Keys per zone">
            <NumberField value={partition.size} min={1} max={48} onChange={(size) => onChange({ ...partition, size })} />
          </Field>
          <Field label="Number of zones">
            <NumberField value={partition.count} min={1} max={64} onChange={(count) => onChange({ ...partition, count })} />
          </Field>
        </div>
      )}

      {partition.mode === "manualZones" && (
        <div className="flex flex-col gap-2">
          {partition.zones.map((z, i) => (
            <div key={z.id} className="flex items-end gap-2">
              <Field label={`Zone ${i + 1} from`}>
                <NoteField value={z.from} onChange={(from) => onChange({ ...partition, zones: partition.zones.map((x) => (x.id === z.id ? { ...x, from } : x)) })} />
              </Field>
              <Field label="to">
                <NoteField value={z.to} onChange={(to) => onChange({ ...partition, zones: partition.zones.map((x) => (x.id === z.id ? { ...x, to } : x)) })} />
              </Field>
              <Btn size="sm" variant="ghost" onClick={() => onChange({ ...partition, zones: partition.zones.filter((x) => x.id !== z.id) })}>
                ✕
              </Btn>
            </div>
          ))}
          <Btn size="sm" onClick={() => onChange({ ...partition, zones: [...partition.zones, { id: uid("z"), from: 48, to: 59 }] })}>
            + zone
          </Btn>
        </div>
      )}

      {partition.mode === "explicitList" && (
        <div className="flex flex-col gap-2">
          {partition.groups.map((g, i) => (
            <div key={g.id} className="flex items-center gap-2">
              <span className="w-14 text-[11px] text-muted">Group {i + 1}</span>
              <DraftTextField
                value={g.notes.join(", ")}
                placeholder="46, 42  or  C1, D1"
                onCommit={(raw) => {
                  const notes = parseNoteList(raw);
                  onChange({ ...partition, groups: partition.groups.map((x) => (x.id === g.id ? { ...x, notes } : x)) });
                }}
              />
              <span className="text-[11px] text-muted">{g.notes.map((n) => noteName(n)).join(" ")}</span>
              <Btn size="sm" variant="ghost" onClick={() => onChange({ ...partition, groups: partition.groups.filter((x) => x.id !== g.id) })}>
                ✕
              </Btn>
            </div>
          ))}
          <Btn size="sm" onClick={() => onChange({ ...partition, groups: [...partition.groups, { id: uid("g"), notes: [] }] })}>
            + group
          </Btn>
        </div>
      )}
    </div>
  );
}

function LayerCard({
  layer,
  buckets,
  isDefault,
  onChange,
  onDelete,
}: {
  layer: Layer;
  buckets: Bucket[];
  isDefault: boolean;
  onChange: (l: Layer) => void;
  onDelete?: () => void;
}) {
  const when = layer.when;
  const setBucket = (id: string, spec: OutputSpec | null) => {
    const next = { ...layer.buckets };
    if (spec === null) delete next[id];
    else next[id] = spec;
    onChange({ ...layer, buckets: next });
  };

  return (
    <div className="rounded-md border border-line bg-panel-2 p-2">
      <div className="mb-2 flex items-center gap-2">
        {isDefault ? (
          <Tag tone="muted">default (pedal released)</Tag>
        ) : (
          <>
            <Tag tone="accent">when</Tag>
            <span className="text-[11px] text-muted">CC</span>
            <NumberField
              value={when === "default" ? 11 : when.cc}
              min={0}
              max={127}
              onChange={(cc) => onChange({ ...layer, when: { ...(when === "default" ? {} : when), cc } })}
            />
            <span className="text-[11px] text-muted">min</span>
            <NumberField
              value={when === "default" ? 64 : (when.min ?? 0)}
              min={0}
              max={127}
              onChange={(min) => onChange({ ...layer, when: { cc: when === "default" ? 11 : when.cc, ...(when === "default" ? {} : when), min } })}
            />
            <span className="text-[11px] text-muted">max</span>
            <NumberField
              value={when === "default" ? 127 : (when.max ?? 127)}
              min={0}
              max={127}
              onChange={(max) => onChange({ ...layer, when: { cc: when === "default" ? 11 : when.cc, ...(when === "default" ? {} : when), max } })}
            />
            {onDelete && (
              <Btn size="sm" variant="ghost" onClick={onDelete}>
                remove layer
              </Btn>
            )}
          </>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {buckets.map((b) => {
          const spec = layer.buckets[b.id];
          const active = spec !== undefined;
          return (
            <div key={b.id} className="flex items-center gap-2 rounded border border-line/60 px-2 py-1">
              <label className="flex w-48 shrink-0 items-center gap-1.5 text-[11px] text-muted">
                {!isDefault && (
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setBucket(b.id, e.target.checked ? { note: 60 } : null)}
                  />
                )}
                <span className="truncate" title={b.label}>{b.label}</span>
              </label>
              {active ? (
                <OutputSpecEditor spec={spec} onChange={(s) => setBucket(b.id, s)} />
              ) : (
                <span className="text-[11px] text-muted">
                  {isDefault ? "— passthrough —" : "falls through to default"}
                </span>
              )}
              {isDefault && active && (
                <Btn size="sm" variant="ghost" onClick={() => setBucket(b.id, null)}>
                  ✕
                </Btn>
              )}
              {isDefault && !active && (
                <Btn size="sm" variant="ghost" onClick={() => setBucket(b.id, { note: 60 })}>
                  map
                </Btn>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function KeyboardMapperEditor({ config, onChange }: { config: Cfg; onChange: (c: Cfg) => void }) {
  const buckets = useMemo(() => bucketsForPartition(config.partition), [config.partition]);
  const defaultLayer = config.layers.find((l) => l.when === "default");
  const condLayers = config.layers.filter((l) => l.when !== "default");

  const setLayers = (layers: Layer[]) => onChange({ ...config, layers });
  const replaceLayer = (l: Layer) => setLayers(config.layers.map((x) => (x.id === l.id ? l : x)));

  return (
    <div className="flex flex-col gap-3">
      <PartitionEditor partition={config.partition} onChange={(partition) => onChange({ ...config, partition })} />

      <Field
        label="Retrigger"
        hint="When a key lands on a note that is already sounding (folded notes), play it again instead of ignoring the hit"
      >
        <Toggle
          checked={config.retrigger ?? false}
          onChange={(retrigger) => onChange({ ...config, retrigger: retrigger || undefined })}
          label="re-play folded notes"
        />
      </Field>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-muted">Layers</span>
          <Btn
            size="sm"
            onClick={() =>
              setLayers([
                { id: uid("layer"), when: { cc: 11, min: 64 }, buckets: {} },
                ...config.layers,
              ])
            }
          >
            + pedal / CC layer
          </Btn>
          <span className="text-[11px] text-muted">condition layers win over default when active</span>
        </div>

        {condLayers.map((l) => (
          <LayerCard
            key={l.id}
            layer={l}
            buckets={buckets}
            isDefault={false}
            onChange={replaceLayer}
            onDelete={() => setLayers(config.layers.filter((x) => x.id !== l.id))}
          />
        ))}

        {defaultLayer ? (
          <LayerCard key={defaultLayer.id} layer={defaultLayer} buckets={buckets} isDefault onChange={replaceLayer} />
        ) : (
          <Btn size="sm" onClick={() => setLayers([...config.layers, { id: uid("layer"), when: "default", buckets: {} }])}>
            + default layer
          </Btn>
        )}
      </div>
    </div>
  );
}
