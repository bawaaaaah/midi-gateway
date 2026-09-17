import { useEffect, useMemo, useRef, useState } from "react";
import type { Route, RuntimePort, TransformConfig } from "@midi-gateway/engine";
import { useStore } from "../store.js";
import { useMergedInputActivity, useRouteOutActivity } from "../lib/activity.js";
import { Btn, Empty, Panel, Tag, Toggle } from "../components/ui.js";
import { PianoKeyboard } from "../components/PianoKeyboard.js";
import { CCMeters } from "../components/CCMeters.js";
import { TRANSFORM_HINTS, TRANSFORM_LABELS, TransformEditor, newTransform } from "./transforms/index.js";

const canSource = (p: RuntimePort) => p.direction === "in" || p.direction === "bidir";
const canDest = (p: RuntimePort) => p.direction === "out" || p.direction === "bidir";

function useRouteDraft(route: Route | undefined) {
  const send = useStore((s) => s.send);
  const [draft, setDraft] = useState<Route | undefined>(route);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDraft(route);
  }, [route?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const push = (next: Route) => {
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void send({ kind: "updateRoute", route: next }).catch(() => {}), 150);
  };

  return [draft, push] as const;
}

function PortPicker({
  label,
  ports,
  selected,
  onToggle,
}: {
  label: string;
  ports: RuntimePort[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div>
      <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {ports.length === 0 && <span className="text-[11px] text-muted">no eligible ports</span>}
        {ports.map((p) => {
          const on = selected.includes(p.id);
          return (
            <button
              key={p.id}
              onClick={() => onToggle(p.id)}
              className={`rounded border px-2 py-1 text-[11px] transition-colors ${
                on ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-ink"
              } ${!p.available ? "opacity-50" : ""}`}
              title={p.available ? "" : "offline"}
            >
              {p.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ChainItem({
  cfg,
  index,
  count,
  onChange,
  onMove,
  onDelete,
}: {
  cfg: TransformConfig;
  index: number;
  count: number;
  onChange: (c: TransformConfig) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(cfg.type === "keyboardMapper" || cfg.type === "combo");
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button onClick={() => setOpen(!open)} className="text-muted hover:text-ink" title="expand">
          {open ? "▾" : "▸"}
        </button>
        <Toggle checked={cfg.enabled} onChange={(enabled) => onChange({ ...cfg, enabled })} />
        <span className="text-[12px] font-medium text-ink">{TRANSFORM_LABELS[cfg.type]}</span>
        {cfg.label && <Tag tone="muted">{cfg.label}</Tag>}
        <span className="ml-auto flex items-center gap-1">
          <Btn size="sm" variant="ghost" disabled={index === 0} onClick={() => onMove(-1)}>▲</Btn>
          <Btn size="sm" variant="ghost" disabled={index === count - 1} onClick={() => onMove(1)}>▼</Btn>
          <Btn size="sm" variant="ghost" onClick={onDelete}>✕</Btn>
        </span>
      </div>
      {open && (
        <div className="border-t border-line p-2">
          <p className="mb-2 text-[11px] text-muted">{TRANSFORM_HINTS[cfg.type]}</p>
          <TransformEditor config={cfg} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

function AddTransform({ onAdd }: { onAdd: (t: TransformConfig["type"]) => void }) {
  const [open, setOpen] = useState(false);
  const types: TransformConfig["type"][] = [
    "keyboardMapper",
    "combo",
    "transpose",
    "velocity",
    "channelRemap",
    "ccRemap",
    "filter",
    "learnTap",
  ];
  return (
    <div className="relative">
      <Btn variant="primary" size="sm" onClick={() => setOpen(!open)}>
        + Add transform
      </Btn>
      {open && (
        <div className="absolute z-10 mt-1 w-72 rounded-md border border-line bg-panel p-1 shadow-xl">
          {types.map((t) => (
            <button
              key={t}
              onClick={() => {
                onAdd(t);
                setOpen(false);
              }}
              className="block w-full rounded px-2 py-1.5 text-left hover:bg-panel-2"
            >
              <div className="text-[12px] font-medium text-ink">{TRANSFORM_LABELS[t]}</div>
              <div className="text-[11px] text-muted">{TRANSFORM_HINTS[t]}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LivePreview({ route }: { route: Route }) {
  const input = useMergedInputActivity(route.sources);
  const output = useRouteOutActivity(route.id);

  const ccSpecs = useMemo(() => {
    const specs: { channel: number; controller: number; label?: string; thresholds?: number[] }[] = [];
    for (const [ch, ctrls] of Object.entries(input.cc)) {
      for (const c of Object.keys(ctrls)) specs.push({ channel: +ch, controller: +c, label: `CC${c}` });
    }
    // surface CC layer thresholds from any keyboardMapper in the chain
    for (const t of route.transforms) {
      if (t.type !== "keyboardMapper") continue;
      for (const l of t.layers) {
        const when = l.when;
        if (when === "default") continue;
        const found = specs.find((s) => s.controller === when.cc);
        const th = [when.min, when.max].filter((n): n is number => n !== undefined);
        if (found) found.thresholds = [...(found.thresholds ?? []), ...th];
        else specs.push({ channel: when.channel ?? 0, controller: when.cc, label: `CC${when.cc}`, thresholds: th });
      }
    }
    return specs;
  }, [input.cc, route.transforms]);

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Input (sources)</div>
          <div className="rounded-md border border-line bg-black/30 p-1">
            <PianoKeyboard held={input.heldNotes} height={56} />
          </div>
        </div>
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Output (this route)</div>
          <div className="rounded-md border border-line bg-black/30 p-1">
            <PianoKeyboard held={output.heldNotes} height={56} />
          </div>
        </div>
      </div>
      {ccSpecs.length > 0 && <CCMeters specs={ccSpecs} values={input.cc} />}
    </div>
  );
}

export function RoutesView() {
  const routes = useStore((s) => s.gs?.preset.routes ?? []);
  const ports = useStore((s) => s.gs?.ports ?? []);
  const send = useStore((s) => s.send);
  const [selId, setSelId] = useState<string | null>(routes[0]?.id ?? null);

  useEffect(() => {
    if (!selId && routes[0]) setSelId(routes[0].id);
    if (selId && !routes.some((r) => r.id === selId)) setSelId(routes[0]?.id ?? null);
  }, [routes, selId]);

  const stored = routes.find((r) => r.id === selId);
  const [draft, pushDraft] = useRouteDraft(stored);

  const sources = ports.filter(canSource);
  const dests = ports.filter(canDest);

  return (
    <div className="grid grid-cols-[220px_1fr] gap-4">
      <Panel
        title="Routes"
        right={
          <Btn size="sm" variant="primary" onClick={() => send({ kind: "addRoute" })}>
            +
          </Btn>
        }
      >
        <div className="flex flex-col gap-1">
          {routes.length === 0 && <Empty>No routes yet.</Empty>}
          {routes.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelId(r.id)}
              className={`rounded-md border px-2 py-1.5 text-left transition-colors ${
                r.id === selId ? "border-accent bg-accent/10" : "border-line hover:border-accent/50"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: r.enabled ? "var(--color-good)" : "var(--color-line)" }}
                />
                <span className="truncate text-[12px] font-medium text-ink">{r.name}</span>
              </div>
              <div className="mt-0.5 text-[10px] text-muted">
                {r.sources.length} in · {r.transforms.length} fx · {r.destinations.length} out
              </div>
            </button>
          ))}
        </div>
      </Panel>

      {!draft ? (
        <Empty>Select or create a route.</Empty>
      ) : (
        <div className="flex flex-col gap-4">
          <Panel
            title={
              <input
                className="rounded border border-transparent bg-transparent px-1 text-[13px] font-semibold text-ink hover:border-line focus:border-accent focus:outline-none"
                value={draft.name}
                onChange={(e) => pushDraft({ ...draft, name: e.target.value })}
              />
            }
            right={
              <div className="flex items-center gap-2">
                <Toggle checked={draft.enabled} onChange={(enabled) => pushDraft({ ...draft, enabled })} label="enabled" />
                <Btn size="sm" variant="danger" onClick={() => send({ kind: "deleteRoute", routeId: draft.id })}>
                  Delete
                </Btn>
              </div>
            }
          >
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-4">
                <PortPicker
                  label="Sources"
                  ports={sources}
                  selected={draft.sources}
                  onToggle={(id) =>
                    pushDraft({
                      ...draft,
                      sources: draft.sources.includes(id) ? draft.sources.filter((x) => x !== id) : [...draft.sources, id],
                    })
                  }
                />
                <PortPicker
                  label="Destinations"
                  ports={dests}
                  selected={draft.destinations}
                  onToggle={(id) =>
                    pushDraft({
                      ...draft,
                      destinations: draft.destinations.includes(id)
                        ? draft.destinations.filter((x) => x !== id)
                        : [...draft.destinations, id],
                    })
                  }
                />
              </div>
              <LivePreview route={draft} />
            </div>
          </Panel>

          <Panel title="Transform chain" right={<AddTransform onAdd={(t) => pushDraft({ ...draft, transforms: [...draft.transforms, newTransform(t)] })} />}>
            <div className="flex flex-col gap-2">
              {draft.transforms.length === 0 && <Empty>No transforms — MIDI passes straight through.</Empty>}
              {draft.transforms.map((cfg, i) => (
                <ChainItem
                  key={cfg.id}
                  cfg={cfg}
                  index={i}
                  count={draft.transforms.length}
                  onChange={(c) =>
                    pushDraft({ ...draft, transforms: draft.transforms.map((x) => (x.id === c.id ? c : x)) })
                  }
                  onMove={(dir) => {
                    const arr = [...draft.transforms];
                    const j = i + dir;
                    if (j < 0 || j >= arr.length) return;
                    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
                    pushDraft({ ...draft, transforms: arr });
                  }}
                  onDelete={() => pushDraft({ ...draft, transforms: draft.transforms.filter((x) => x.id !== cfg.id) })}
                />
              ))}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
