import { useEffect, useState } from "react";
import { useStore } from "./store.js";
import { Btn } from "./components/ui.js";
import { PortsView } from "./views/PortsView.js";
import { RoutesView } from "./views/RoutesView.js";
import { LearnView } from "./views/LearnView.js";
import { MonitorView } from "./views/MonitorView.js";
import { PresetsView } from "./views/PresetsView.js";

const TABS = ["Routes", "Ports", "Learn", "Monitor", "Presets"] as const;
type Tab = (typeof TABS)[number];

export function App() {
  const [tab, setTab] = useState<Tab>("Routes");
  const connected = useStore((s) => s.connected);
  const latency = useStore((s) => s.latencyMs);
  const gs = useStore((s) => s.gs);
  const lastError = useStore((s) => s.lastError);
  const send = useStore((s) => s.send);
  const setSubscription = useStore((s) => s.setSubscription);

  useEffect(() => {
    const channels: ("monitor" | "activity" | "learn")[] = ["activity"];
    if (tab === "Monitor") channels.push("monitor");
    if (tab === "Learn") channels.push("learn");
    setSubscription(channels);
  }, [tab, setSubscription]);

  const dirty = gs?.dirty ?? false;
  const presetName = gs?.activePresetName ?? gs?.preset.name ?? "—";

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-panel px-4 py-2">
        <span className="text-[13px] font-bold tracking-tight">MIDI Gateway</span>
        <nav className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                tab === t ? "bg-accent/20 text-accent" : "text-muted hover:text-ink"
              }`}
            >
              {t}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3 text-[12px]">
          <span className="text-muted">
            {presetName}
            {dirty && <span className="ml-0.5 text-warn">•</span>}
          </span>
          <Btn size="sm" variant="primary" disabled={!connected} onClick={() => send({ kind: "savePreset" })}>
            Save
          </Btn>
          <Btn size="sm" variant="danger" disabled={!connected} onClick={() => send({ kind: "panic" })} title="All notes off on every destination">
            Panic
          </Btn>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: connected ? "var(--color-good)" : "var(--color-bad)" }}
            />
            <span className="tabular-nums text-muted">
              {connected ? (latency != null ? `${latency} ms` : "live") : "offline"}
            </span>
          </span>
        </div>
      </header>

      {lastError && (
        <div className="border-b border-bad/30 bg-bad/10 px-4 py-1 text-[12px] text-bad">{lastError}</div>
      )}

      <main className="min-h-0 flex-1 overflow-auto p-4">
        {!gs ? (
          <div className="grid h-full place-items-center text-muted">Connecting to the gateway…</div>
        ) : tab === "Routes" ? (
          <RoutesView />
        ) : tab === "Ports" ? (
          <PortsView />
        ) : tab === "Learn" ? (
          <LearnView />
        ) : tab === "Monitor" ? (
          <MonitorView />
        ) : (
          <PresetsView />
        )}
      </main>
    </div>
  );
}
