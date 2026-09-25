import { type ReactNode, useRef, useState } from "react";
import { noteName, parseNoteName } from "@midi-gateway/engine";

export function Panel({ title, right, children, className = "" }: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-line bg-panel ${className}`}>
      {title !== undefined && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
          <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
          {right}
        </header>
      )}
      <div className="p-3">{children}</div>
    </section>
  );
}

export function Btn({
  children,
  onClick,
  variant = "default",
  size = "md",
  disabled,
  title,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "sm" | "md";
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
}) {
  const base =
    "inline-flex items-center gap-1.5 rounded-md border font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const sizes = { sm: "px-2 py-1 text-[12px]", md: "px-2.5 py-1.5 text-[12px]" };
  const variants = {
    default: "border-line bg-panel-2 text-ink hover:border-accent/60",
    primary: "border-accent/40 bg-accent/15 text-accent hover:bg-accent/25",
    danger: "border-bad/40 bg-bad/10 text-bad hover:bg-bad/20",
    ghost: "border-transparent bg-transparent text-muted hover:text-ink hover:bg-panel-2",
  };
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick} className={`${base} ${sizes[size]} ${variants[variant]}`}>
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  // A plain <div>, not a <label>: several fields hold buttons (Segmented, Toggle),
  // and a label click would activate the first one.
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-muted">{label}</span>
      <div>{children}</div>
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-line bg-panel-2 px-2 py-1.5 text-[12px] text-ink outline-none focus:border-accent";

export function TextField({ value, onChange, placeholder, onBlur }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onBlur?: () => void;
}) {
  return (
    <input
      className={inputCls}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    />
  );
}

/**
 * Text input bound to a server value that only reports the edit on blur / Enter
 * (Escape reverts). Typing never round-trips through the server, so keystrokes
 * can't be lost or reordered, and clearing the field to retype is possible.
 */
export function DraftTextField({ value, onCommit, placeholder, allowEmpty = true, className = inputCls }: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  /** When false, an empty / blank value is discarded instead of committed. */
  allowEmpty?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null); // null = not editing
  const cancelled = useRef(false);
  return (
    <input
      className={className}
      value={draft ?? value}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        const v = e.currentTarget.value;
        setDraft(null);
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        if (v !== value && (allowEmpty || v.trim())) onCommit(v);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function NumberField({ value, onChange, min, max, step = 1, suffix }: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  // What the user is typing; lets them clear the field or type "-" without it
  // snapping back to a number on every keystroke.
  const [text, setText] = useState<string | null>(null);
  const integer = Number.isInteger(step);
  return (
    <span className="flex items-center gap-1">
      <input
        type="number"
        className={inputCls}
        value={text ?? (Number.isFinite(value) ? value : 0)}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.trim() === "") return;
          const n = Number(e.target.value);
          if (!Number.isFinite(n)) return;
          const v = clamp(integer ? Math.round(n) : n, min, max);
          if (v !== value) onChange(v);
        }}
        onBlur={() => setText(null)}
      />
      {suffix && <span className="text-[11px] text-muted">{suffix}</span>}
    </span>
  );
}

export function Select<T extends string | number>({ value, onChange, options }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select
      className={inputCls}
      value={String(value)}
      onChange={(e) => {
        const raw = e.target.value;
        const match = options.find((o) => String(o.value) === raw);
        if (match) onChange(match.value);
      }}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-md border border-line bg-panel-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
            value === o.value ? "bg-accent/20 text-accent" : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-[12px] text-ink"
    >
      <span
        className={`relative h-4 w-7 rounded-full transition-colors ${checked ? "bg-accent" : "bg-line"}`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${checked ? "left-3.5" : "left-0.5"}`}
        />
      </span>
      {label}
    </button>
  );
}

export function NoteField({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  // Partial names ("D", "F#") don't parse yet: keep them as typed until they do.
  const [name, setName] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-1">
      <NumberField value={value} min={0} max={127} onChange={onChange} />
      <input
        className={`${inputCls} !w-16 text-center`}
        value={name ?? noteName(value)}
        onChange={(e) => {
          setName(e.target.value);
          const n = parseNoteName(e.target.value);
          if (n !== null && n !== value) onChange(n);
        }}
        onBlur={() => setName(null)}
        title="Note name (C4 = 60)"
      />
    </span>
  );
}

export function Tag({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "good" | "warn" | "bad" | "accent" }) {
  const tones = {
    muted: "border-line text-muted",
    good: "border-good/40 text-good",
    warn: "border-warn/40 text-warn",
    bad: "border-bad/40 text-bad",
    accent: "border-accent/40 text-accent",
  };
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${tones[tone]}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-line px-3 py-6 text-center text-[12px] text-muted">{children}</div>;
}

function clamp(n: number, min?: number, max?: number): number {
  if (min !== undefined) n = Math.max(min, n);
  if (max !== undefined) n = Math.min(max, n);
  return n;
}
