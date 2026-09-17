import { useMemo, useState } from "react";
import {
  buildComboFromLearn,
  buildKeyboardMapperFromLearn,
  gmDrumName,
  noteName,
  type LearnObservation,
} from "@midi-gateway/engine";
import { useStore } from "../store.js";
import { useMergedInputActivity } from "../lib/activity.js";
import { Btn, Empty, Field, Panel, Select, Tag, TextField } from "../components/ui.js";
import { PianoKeyboard } from "../components/PianoKeyboard.js";
import { PadGrid } from "../components/PadGrid.js";

function ccHints(o: LearnObservation): string[] {
  return Object.entries(o.concurrentCc)
    .filter(([, c]) => c.count >= 2)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 3)
    .map(([cc, c]) => `CC${cc}≈${Math.round((c.min + c.max) / 2)}`);
}

export function LearnView() {
  const send = useStore((s) => s.send);
  const learn = useStore((s) => s.learn);
  const learnState = useStore((s) => s.gs?.learn ?? { active: false, routeId: null });
  const routes = useStore((s) => s.gs?.preset.routes ?? []);
  const ports = useStore((s) => s.gs?.ports ?? []);
  const noteNames = useStore((s) => s.gs?.preset.noteNames ?? {});

  const inputPortIds = useMemo(
    () => ports.filter((p) => p.direction !== "out").map((p) => p.id),
    [ports],
  );
  const activity = useMergedInputActivity(inputPortIds);

  const [sel, setSel] = useState<Set<string>>(new Set());
  const [targetRoute, setTargetRoute] = useState<string>(routes[0]?.id ?? "");

  const noteRows = learn.filter((o) => o.kind === "noteOn");
  const selectedNotes = noteRows.filter((o) => sel.has(o.signature) && o.note !== undefined);
  const learnedPadNotes = [...new Set(noteRows.map((o) => o.note!).filter((n) => n !== undefined))].sort((a, b) => a - b);

  const toggle = (sig: string) =>
    setSel((s) => {
      const n = new Set(s);
      n.has(sig) ? n.delete(sig) : n.add(sig);
      return n;
    });

  const nameGmForAll = () => {
    const names: Record<string, string> = {};
    for (const o of noteRows) {
      if (o.note === undefined) continue;
      const gm = gmDrumName(o.note);
      if (gm && !noteNames[o.note]) names[o.note] = gm;
    }
    if (Object.keys(names).length) send({ kind: "bulkSetNoteNames", names });
  };

  const createKeyboardMapper = () => {
    if (!targetRoute || selectedNotes.length === 0) return;
    const cfg = buildKeyboardMapperFromLearn({
      label: "From learn",
      base: selectedNotes.map((o) => ({
        note: o.note!,
        output: { note: o.note!, name: noteNames[o.note!] ?? gmDrumName(o.note!) },
      })),
    });
    send({ kind: "addTransform", routeId: targetRoute, config: cfg });
  };

  const createHiHat = () => {
    if (!targetRoute || selectedNotes.length === 0) return;
    // Use the strongest concurrent CC across the selection as the pedal.
    const ccTally = new Map<number, number>();
    for (const o of selectedNotes)
      for (const [cc, c] of Object.entries(o.concurrentCc)) ccTally.set(+cc, (ccTally.get(+cc) ?? 0) + c.count);
    const pedalCc = [...ccTally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 4;
    const notes = selectedNotes.map((o) => o.note!);
    const cfg = buildKeyboardMapperFromLearn({
      label: "Hi-hat by pedal",
      base: notes.map((n) => ({ note: n, output: { note: n, name: "open" } })),
      pedalLayers: [
        { cc: pedalCc, min: 1, max: 40, label: "half", mappings: notes.map((n) => ({ note: n, output: { note: n, name: "half" } })) },
        { cc: pedalCc, min: 41, label: "closed", mappings: notes.map((n) => ({ note: n, output: { note: n, name: "closed" } })) },
      ],
    });
    send({ kind: "addTransform", routeId: targetRoute, config: cfg });
  };

  const createCombo = () => {
    if (!targetRoute || selectedNotes.length < 2) return;
    const cfg = buildComboFromLearn({
      label: "From learn",
      triggers: selectedNotes.map((o) => ({ kind: "note" as const, value: o.note! })),
      output: { note: 99 },
    });
    send({ kind: "addTransform", routeId: targetRoute, config: cfg });
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <Panel
        title="Auto-learn"
        right={
          <div className="flex items-center gap-2">
            <Select
              value={learnState.routeId ?? "__all__"}
              onChange={(v) => {
                const routeId = v === "__all__" ? undefined : v;
                if (learnState.active) send({ kind: "learnStart", routeId });
              }}
              options={[{ value: "__all__", label: "All inputs" }, ...routes.map((r) => ({ value: r.id, label: r.name }))]}
            />
            {learnState.active ? (
              <Btn variant="danger" onClick={() => send({ kind: "learnStop" })}>
                Stop
              </Btn>
            ) : (
              <Btn variant="primary" onClick={() => send({ kind: "learnStart" })}>
                Start learning
              </Btn>
            )}
            <Btn variant="ghost" onClick={() => { send({ kind: "learnClear" }); setSel(new Set()); }}>
              Clear
            </Btn>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="rounded-md border border-line bg-black/30 p-1">
            <PianoKeyboard held={activity.heldNotes} noteNames={noteNames} height={64} />
          </div>
          {learnedPadNotes.length > 0 && (
            <PadGrid notes={learnedPadNotes} held={activity.heldNotes} noteNames={noteNames} />
          )}
          {!learnState.active && learn.length === 0 && (
            <Empty>Press “Start learning”, then play your controller. Captured events appear below.</Empty>
          )}
        </div>
      </Panel>

      {learn.length > 0 && (
        <Panel
          title={`Captured (${learn.length})`}
          right={
            <div className="flex items-center gap-2">
              <Btn size="sm" onClick={nameGmForAll}>
                Name as GM drums
              </Btn>
            </div>
          }
        >
          <table className="w-full text-[12px]">
            <thead className="text-[11px] uppercase tracking-wide text-muted">
              <tr className="border-b border-line">
                <th className="w-6" />
                <th className="py-1 text-left">Event</th>
                <th className="py-1 text-left">Name</th>
                <th className="py-1 text-right">Count</th>
                <th className="py-1 text-right">Vel</th>
                <th className="py-1 text-left">While held</th>
              </tr>
            </thead>
            <tbody>
              {learn.map((o) => (
                <tr key={o.signature} className="border-b border-line/40">
                  <td>
                    {o.kind === "noteOn" && (
                      <input type="checkbox" checked={sel.has(o.signature)} onChange={() => toggle(o.signature)} />
                    )}
                  </td>
                  <td className="py-1">
                    <span className="text-ink">
                      {o.kind === "noteOn"
                        ? `Note ${noteName(o.note ?? 0)} (${o.note})`
                        : o.kind === "cc"
                          ? `CC ${o.controller}`
                          : o.kind}
                    </span>
                    <span className="ml-1 text-[10px] text-muted">ch{o.channel + 1}</span>
                  </td>
                  <td className="py-1">
                    {o.note !== undefined ? (
                      <TextField
                        value={noteNames[o.note] ?? ""}
                        placeholder={gmDrumName(o.note) ?? "name"}
                        onChange={(name) => send({ kind: "setNoteName", note: o.note!, name })}
                      />
                    ) : null}
                  </td>
                  <td className="py-1 text-right tabular-nums text-muted">{o.count}</td>
                  <td className="py-1 text-right tabular-nums text-muted">
                    {o.velocityMin !== undefined ? `${o.velocityMin}–${o.velocityMax}` : "—"}
                  </td>
                  <td className="py-1">
                    <span className="flex flex-wrap gap-1">
                      {ccHints(o).map((h) => (
                        <Tag key={h} tone="warn">
                          {h}
                        </Tag>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {selectedNotes.length > 0 && (
        <Panel title={`Mass edit — ${selectedNotes.length} note${selectedNotes.length > 1 ? "s" : ""} selected`}>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Target route">
              <Select
                value={targetRoute}
                onChange={setTargetRoute}
                options={routes.map((r) => ({ value: r.id, label: r.name }))}
              />
            </Field>
            <Btn variant="primary" disabled={!targetRoute} onClick={createKeyboardMapper}>
              → Keyboard mapper
            </Btn>
            <Btn variant="primary" disabled={!targetRoute} onClick={createHiHat}>
              → Hi-hat by pedal
            </Btn>
            <Btn variant="primary" disabled={!targetRoute || selectedNotes.length < 2} onClick={createCombo}>
              → Combo
            </Btn>
          </div>
          <p className="mt-2 text-[11px] text-muted">
            Creates a transform on the target route pre-filled from the selection. Fine-tune it in the Routes tab.
          </p>
        </Panel>
      )}
    </div>
  );
}
