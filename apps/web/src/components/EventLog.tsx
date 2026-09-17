import { noteName } from "@midi-gateway/engine";
import type { MidiEvent, MonitorEvent } from "@midi-gateway/engine";

function describe(ev: MidiEvent): { label: string; detail: string } {
  switch (ev.kind) {
    case "noteOn":
      return { label: "Note On", detail: `${noteName(ev.note)} (${ev.note})  vel ${ev.velocity}  ch${ev.channel + 1}` };
    case "noteOff":
      return { label: "Note Off", detail: `${noteName(ev.note)} (${ev.note})  ch${ev.channel + 1}` };
    case "cc":
      return { label: "CC", detail: `#${ev.controller} = ${ev.value}  ch${ev.channel + 1}` };
    case "pitchBend":
      return { label: "Pitch Bend", detail: `${ev.value - 8192}  ch${ev.channel + 1}` };
    case "aftertouch":
      return { label: "Aftertouch", detail: `${ev.note !== undefined ? `${noteName(ev.note)} ` : ""}${ev.pressure}  ch${ev.channel + 1}` };
    case "program":
      return { label: "Program", detail: `${ev.program}  ch${ev.channel + 1}` };
    case "raw":
      return { label: "Raw", detail: ev.bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ") };
  }
}

const kindTone: Record<string, string> = {
  noteOn: "text-good",
  noteOff: "text-muted",
  cc: "text-accent",
  pitchBend: "text-warn",
};

export function EventLog({ events }: { events: MonitorEvent[] }) {
  return (
    <div className="h-full overflow-auto rounded-md border border-line bg-panel-2 font-mono text-[11px]">
      <table className="w-full">
        <tbody>
          {events.map((m) => {
            const d = describe(m.event);
            return (
              <tr key={m.seq} className="border-b border-line/40">
                <td className="w-14 px-2 py-0.5 text-muted tabular-nums">{Math.round(m.t)}</td>
                <td className="w-8 px-1 py-0.5">
                  <span className={m.stage === "in" ? "text-accent" : "text-warn"}>{m.stage === "in" ? "▸in" : "out▸"}</span>
                </td>
                <td className="w-40 truncate px-2 py-0.5 text-muted">{m.portName}</td>
                <td className={`w-20 px-2 py-0.5 ${kindTone[m.event.kind] ?? "text-ink"}`}>{d.label}</td>
                <td className="px-2 py-0.5 text-ink">{d.detail}</td>
              </tr>
            );
          })}
          {events.length === 0 && (
            <tr>
              <td className="px-3 py-6 text-center text-muted" colSpan={5}>
                No traffic yet — play something into a routed input.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
