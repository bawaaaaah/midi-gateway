import { useMemo } from "react";
import { useStore } from "../store.js";
import { useActivity } from "../lib/activity.js";
import { Btn, Panel, Toggle } from "../components/ui.js";
import { PianoKeyboard } from "../components/PianoKeyboard.js";
import { CCMeters } from "../components/CCMeters.js";
import { EventLog } from "../components/EventLog.js";

export function MonitorView() {
  const monitor = useStore((s) => s.monitor);
  const paused = useStore((s) => s.monitorPaused);
  const setPaused = useStore((s) => s.setMonitorPaused);
  const clear = useStore((s) => s.clearMonitor);
  const noteNames = useStore((s) => s.gs?.preset.noteNames ?? {});
  const activity = useActivity();

  const { held, ccSpecs, ccValues } = useMemo(() => {
    const heldNotes = [] as { channel: number; note: number; velocity: number; since: number }[];
    const ccValues: Record<number, Record<number, number>> = {};
    const seen = new Set<string>();
    for (const [key, sc] of Object.entries(activity?.scopes ?? {})) {
      if (!key.startsWith("port:")) continue;
      heldNotes.push(...sc.heldNotes);
      for (const [ch, ctrls] of Object.entries(sc.cc)) {
        for (const [c, v] of Object.entries(ctrls)) {
          ccValues[+ch] = { ...(ccValues[+ch] ?? {}), [+c]: v };
          seen.add(`${ch}:${c}`);
        }
      }
    }
    const ccSpecs = [...seen].map((k) => {
      const [ch, c] = k.split(":").map(Number) as [number, number];
      return { channel: ch, controller: c, label: `CC${c}` };
    });
    return { held: heldNotes, ccSpecs, ccValues };
  }, [activity]);

  const recent = monitor.slice(-400).reverse();

  return (
    <div className="flex h-full flex-col gap-3">
      <Panel title="Live activity — all inputs">
        <div className="flex flex-col gap-2">
          <div className="rounded-md border border-line bg-black/30 p-1">
            <PianoKeyboard held={held} noteNames={noteNames} height={60} />
          </div>
          {ccSpecs.length > 0 && <CCMeters specs={ccSpecs} values={ccValues} />}
        </div>
      </Panel>

      <Panel
        title={`Event log (${monitor.length})`}
        className="flex min-h-0 flex-1 flex-col"
        right={
          <div className="flex items-center gap-2">
            <Toggle checked={paused} onChange={setPaused} label="pause" />
            <Btn size="sm" variant="ghost" onClick={clear}>
              clear
            </Btn>
          </div>
        }
      >
        <div className="h-[52vh]">
          <EventLog events={recent} />
        </div>
      </Panel>
    </div>
  );
}
