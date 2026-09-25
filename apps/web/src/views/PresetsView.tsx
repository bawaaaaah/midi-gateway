import { useState } from "react";
import { GM_DRUM_NAMES, noteName } from "@midi-gateway/engine";
import { useStore } from "../store.js";
import { Btn, DraftTextField, Empty, Field, Panel, Tag, TextField } from "../components/ui.js";

export function PresetsView() {
  const send = useStore((s) => s.send);
  const gs = useStore((s) => s.gs);
  const [newName, setNewName] = useState("");
  const [dupName, setDupName] = useState("");

  if (!gs) return null;
  const { preset, presetList, activePresetName, dirty, presetsDir } = gs;
  const noteNames = preset.noteNames;
  /** Ask before an action that would drop unsaved edits. */
  const okToDiscard = () => !dirty || window.confirm("The current preset has unsaved changes. Discard them?");

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <Panel title="Current preset">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Name">
            <DraftTextField
              value={preset.name}
              allowEmpty={false}
              onCommit={(v) => send({ kind: "renamePreset", name: v.trim() })}
            />
          </Field>
          <Btn variant="primary" onClick={() => send({ kind: "savePreset" })}>
            Save
          </Btn>
          {dirty ? <Tag tone="warn">unsaved changes</Tag> : <Tag tone="good">saved</Tag>}
          <span className="text-[11px] text-muted">
            {activePresetName ? `file: ${activePresetName}.json` : "no file yet — Save creates one"}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="New preset">
            <TextField value={newName} onChange={setNewName} placeholder="My kit" />
          </Field>
          <Btn
            onClick={async () => {
              if (!newName.trim() || !okToDiscard()) return;
              if (await send({ kind: "newPreset", name: newName.trim() })) setNewName("");
            }}
          >
            Create
          </Btn>
          <Field label="Duplicate current as">
            <TextField value={dupName} onChange={setDupName} placeholder="My kit copy" />
          </Field>
          <Btn
            onClick={async () => {
              if (!dupName.trim()) return;
              // No `from`: copies the preset as it is now, unsaved edits included.
              if (await send({ kind: "duplicatePreset", to: dupName.trim() })) setDupName("");
            }}
          >
            Duplicate
          </Btn>
        </div>
      </Panel>

      <Panel
        title={`Preset files (${presetList.length})`}
        right={
          <Btn size="sm" variant="ghost" onClick={() => send({ kind: "revealPresets" })}>
            Reveal folder
          </Btn>
        }
      >
        <p className="mb-2 text-[11px] text-muted">{presetsDir}</p>
        {presetList.length === 0 ? (
          <Empty>No preset files yet.</Empty>
        ) : (
          <div className="flex flex-col gap-1">
            {presetList.map((p) => (
              <div key={p.file} className="flex items-center gap-3 rounded-md border border-line bg-panel-2 px-3 py-1.5">
                <span className="text-[12px] font-medium text-ink">{p.title}</span>
                {p.title !== p.name && <span className="text-[11px] text-muted">{p.file}</span>}
                {p.name === activePresetName && <Tag tone="accent">active</Tag>}
                <span className="text-[11px] text-muted">
                  {p.routeCount >= 0 ? `${p.routeCount} routes` : "unreadable"} ·{" "}
                  {p.updatedAt ? new Date(p.updatedAt).toLocaleString() : "—"}
                </span>
                <span className="ml-auto flex gap-1">
                  <Btn size="sm" onClick={() => okToDiscard() && send({ kind: "loadPreset", name: p.name })}>
                    Load
                  </Btn>
                  <Btn size="sm" variant="ghost" onClick={() => send({ kind: "duplicatePreset", from: p.name, to: `${p.title} copy` })}>
                    Duplicate
                  </Btn>
                  <Btn
                    size="sm"
                    variant="danger"
                    onClick={() => window.confirm(`Delete ${p.file}? This cannot be undone.`) && send({ kind: "deletePreset", name: p.name })}
                  >
                    Delete
                  </Btn>
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title={`Track names (${Object.keys(noteNames).length})`}
        right={
          <Btn
            size="sm"
            onClick={() => send({ kind: "bulkSetNoteNames", names: Object.fromEntries(Object.entries(GM_DRUM_NAMES).map(([k, v]) => [k, v])) })}
          >
            Load GM drum names
          </Btn>
        }
      >
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 md:grid-cols-3">
          {Object.entries(noteNames)
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .map(([note, name]) => (
              <div key={note} className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-[11px] text-muted">
                  {noteName(Number(note))} · {note}
                </span>
                <DraftTextField value={name} onCommit={(v) => send({ kind: "setNoteName", note: Number(note), name: v })} />
              </div>
            ))}
          {Object.keys(noteNames).length === 0 && <Empty>No named notes. Use Learn or “Load GM drum names”.</Empty>}
        </div>
      </Panel>
    </div>
  );
}
