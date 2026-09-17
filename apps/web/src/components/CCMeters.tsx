/**
 * Live bars for a set of CCs. Optional threshold markers show where a
 * keyboardMapper layer condition would switch, so you can *see* which layer is
 * active right now.
 */
export interface CCMeterSpec {
  channel: number;
  controller: number;
  label?: string;
  /** thresholds to draw as ticks, e.g. [30, 80] for hi-hat open/half/closed. */
  thresholds?: number[];
}

export function CCMeters({
  specs,
  values,
}: {
  specs: CCMeterSpec[];
  /** channel -> controller -> value */
  values: Record<number, Record<number, number>>;
}) {
  if (specs.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {specs.map((s, i) => {
        const v = values[s.channel]?.[s.controller] ?? 0;
        const pct = (v / 127) * 100;
        return (
          <div key={`${s.channel}:${s.controller}:${i}`} className="flex items-center gap-2">
            <span className="w-24 shrink-0 truncate text-[11px] text-muted">
              {s.label ?? `CC${s.controller}`}
              <span className="ml-1 text-[10px] opacity-60">ch{s.channel + 1}</span>
            </span>
            <div className="relative h-3 flex-1 overflow-hidden rounded bg-panel-2">
              <div className="absolute inset-y-0 left-0 bg-accent/70" style={{ width: `${pct}%` }} />
              {(s.thresholds ?? []).map((t) => (
                <div
                  key={t}
                  className="absolute inset-y-0 w-px bg-warn"
                  style={{ left: `${(t / 127) * 100}%` }}
                  title={`threshold ${t}`}
                />
              ))}
            </div>
            <span className="w-8 text-right text-[11px] tabular-nums text-ink">{v}</span>
          </div>
        );
      })}
    </div>
  );
}
