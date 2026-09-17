import { noteName } from "@midi-gateway/engine";
import type { HeldNote } from "@midi-gateway/engine";

/**
 * Drum-pad grid. `notes` is the set of pads to show; a pad lights while its
 * note is held. Recently-hit-but-released pads are also passed in via `recent`.
 */
export function PadGrid({
  notes,
  held = [],
  recent = {},
  noteNames = {},
  onPad,
}: {
  notes: number[];
  held?: HeldNote[];
  recent?: Record<number, number>; // note -> velocity of last hit
  noteNames?: Record<number, string>;
  onPad?: (note: number) => void;
}) {
  const heldSet = new Map(held.map((h) => [h.note, h.velocity]));
  const cols = Math.min(8, Math.max(3, Math.ceil(Math.sqrt(notes.length))));

  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
      {notes.map((n) => {
        const on = heldSet.get(n);
        const rv = recent[n];
        const active = on !== undefined;
        return (
          <button
            key={n}
            type="button"
            onPointerDown={() => onPad?.(n)}
            className={`flex aspect-square flex-col items-center justify-center rounded-md border p-1 text-center transition-colors ${
              active ? "border-accent bg-accent/25" : rv ? "border-warn/50 bg-warn/10" : "border-line bg-panel-2"
            }`}
            style={active && on ? { boxShadow: `0 0 0 ${1 + (on / 127) * 3}px var(--color-accent)` } : undefined}
          >
            <span className="text-[11px] font-semibold text-ink">{noteNames[n] || noteName(n)}</span>
            <span className="text-[9px] text-muted">{noteName(n)} · {n}</span>
          </button>
        );
      })}
    </div>
  );
}
