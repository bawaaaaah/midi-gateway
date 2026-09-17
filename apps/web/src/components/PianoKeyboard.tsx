import { useMemo } from "react";
import { noteName, pitchClass } from "@midi-gateway/engine";
import type { HeldNote } from "@midi-gateway/engine";

const BLACK = new Set([1, 3, 6, 8, 10]);

export function PianoKeyboard({
  held = [],
  lo = 21,
  hi = 108,
  height = 84,
  noteNames = {},
  onNote,
}: {
  held?: HeldNote[];
  lo?: number;
  hi?: number;
  height?: number;
  noteNames?: Record<number, string>;
  onNote?: (note: number) => void;
}) {
  const heldMap = useMemo(() => {
    const m = new Map<number, HeldNote>();
    for (const h of held) m.set(h.note, h);
    return m;
  }, [held]);

  const whites = useMemo(() => {
    const list: number[] = [];
    for (let n = lo; n <= hi; n++) if (!BLACK.has(pitchClass(n))) list.push(n);
    return list;
  }, [lo, hi]);

  const W = 100;
  const wk = W / whites.length;
  const whiteIndex = (n: number) => whites.findIndex((w) => w >= n);

  const keyFill = (n: number, black: boolean) => {
    const h = heldMap.get(n);
    if (h) {
      const t = h.velocity / 127;
      return `color-mix(in srgb, var(--color-accent) ${30 + t * 70}%, var(--color-warn))`;
    }
    return black ? "#0c0d12" : "#e9ebf2";
  };

  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="w-full select-none" style={{ height }}>
      {whites.map((n, i) => (
        <rect
          key={n}
          x={i * wk}
          y={0}
          width={wk - 0.15}
          height={height}
          rx={0.6}
          fill={keyFill(n, false)}
          stroke="#0000"
          onPointerDown={() => onNote?.(n)}
          style={{ cursor: onNote ? "pointer" : "default" }}
        >
          <title>{`${noteName(n)}${noteNames[n] ? ` · ${noteNames[n]}` : ""}`}</title>
        </rect>
      ))}
      {(() => {
        const out: React.ReactNode[] = [];
        for (let n = lo; n <= hi; n++) {
          if (!BLACK.has(pitchClass(n))) continue;
          const idx = whiteIndex(n);
          if (idx <= 0) continue;
          const x = idx * wk - wk * 0.32;
          out.push(
            <rect
              key={n}
              x={x}
              y={0}
              width={wk * 0.64}
              height={height * 0.62}
              rx={0.6}
              fill={keyFill(n, true)}
              stroke="#000"
              strokeWidth={0.15}
              onPointerDown={() => onNote?.(n)}
              style={{ cursor: onNote ? "pointer" : "default" }}
            >
              <title>{`${noteName(n)}${noteNames[n] ? ` · ${noteNames[n]}` : ""}`}</title>
            </rect>,
          );
        }
        return out;
      })()}
    </svg>
  );
}
