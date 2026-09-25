import { useMemo, useState } from "react";
import type { RuntimePort } from "@midi-gateway/engine";
import { useStore } from "../store.js";
import { usePortLevel } from "../lib/activity.js";
import { ActivityLed } from "../components/ActivityLed.js";
import { Btn, DraftTextField, Empty, Field, Panel, Segmented, Tag, TextField, NumberField } from "../components/ui.js";

const kindLabel: Record<RuntimePort["kind"], string> = {
  "hw-in": "Hardware in",
  "hw-out": "Hardware out",
  "virtual-in": "Virtual in",
  "virtual-out": "Virtual out",
  rtp: "Network (RTP)",
};

function PortRow({ port }: { port: RuntimePort }) {
  const send = useStore((s) => s.send);
  const level = usePortLevel(port.id);

  return (
    <div className="flex items-center gap-3 rounded-md border border-line bg-panel-2 px-3 py-2">
      <ActivityLed level={level} connected={port.connected} />
      <DraftTextField
        className="w-52 rounded border border-transparent bg-transparent px-1 py-0.5 text-[13px] font-medium text-ink hover:border-line focus:border-accent focus:outline-none"
        value={port.name}
        allowEmpty={false}
        onCommit={(name) => send({ kind: "renamePort", portId: port.id, name: name.trim() })}
      />
      <Tag tone="muted">{kindLabel[port.kind]}</Tag>
      <Tag tone={port.direction === "bidir" ? "accent" : "muted"}>{port.direction}</Tag>
      {!port.available ? (
        <Tag tone="warn">offline</Tag>
      ) : port.kind === "rtp" && !port.connected ? (
        <Tag tone="muted">waiting for peer</Tag>
      ) : (
        <Tag tone="good">connected</Tag>
      )}
      {port.rtp && (
        <span className="text-[11px] text-muted">
          :{port.rtp.localPort} · {port.rtp.mode}
          {port.rtp.remoteHost ? ` → ${port.rtp.remoteHost}:${port.rtp.remotePort}` : ""}
        </span>
      )}
      <Btn
        size="sm"
        variant="ghost"
        onClick={() => window.confirm(`Remove "${port.name}"? Routes using it will lose it.`) && send({ kind: "deletePort", portId: port.id })}
      >
        Remove
      </Btn>
    </div>
  );
}

function AddVirtual() {
  const send = useStore((s) => s.send);
  const [name, setName] = useState("Gateway In");
  const [dir, setDir] = useState<"in" | "out">("in");
  return (
    <div className="flex items-end gap-2">
      <Field label="Name">
        <TextField value={name} onChange={setName} />
      </Field>
      <Field label="Direction">
        <Segmented
          value={dir}
          onChange={setDir}
          options={[
            { value: "in", label: "In (apps send to us)" },
            { value: "out", label: "Out (apps read from us)" },
          ]}
        />
      </Field>
      <Btn variant="primary" onClick={() => name.trim() && send({ kind: "createVirtualPort", direction: dir, name: name.trim() })}>
        Create virtual port
      </Btn>
    </div>
  );
}

function AddHardware() {
  const send = useStore((s) => s.send);
  const inputs = useStore((s) => s.gs?.availableInputs ?? []);
  const outputs = useStore((s) => s.gs?.availableOutputs ?? []);
  if (inputs.length === 0 && outputs.length === 0) {
    return <Empty>No unconfigured hardware/OS ports detected.</Empty>;
  }
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Inputs</div>
        <div className="flex flex-col gap-1">
          {inputs.map((n) => (
            <button
              key={n}
              onClick={() => send({ kind: "addHardwarePort", direction: "in", systemName: n })}
              className="rounded border border-line bg-panel-2 px-2 py-1 text-left text-[12px] hover:border-accent"
            >
              + {n}
            </button>
          ))}
          {inputs.length === 0 && <span className="text-[11px] text-muted">none</span>}
        </div>
      </div>
      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Outputs</div>
        <div className="flex flex-col gap-1">
          {outputs.map((n) => (
            <button
              key={n}
              onClick={() => send({ kind: "addHardwarePort", direction: "out", systemName: n })}
              className="rounded border border-line bg-panel-2 px-2 py-1 text-left text-[12px] hover:border-accent"
            >
              + {n}
            </button>
          ))}
          {outputs.length === 0 && <span className="text-[11px] text-muted">none</span>}
        </div>
      </div>
    </div>
  );
}

/** Each RTP session binds its port and port + 1: suggest the first free pair from `base`. */
function nextFreeRtpPort(ports: RuntimePort[], base: number): number {
  const used = ports.flatMap((p) => (p.rtp ? [p.rtp.localPort] : []));
  let port = base;
  while (used.some((u) => Math.abs(u - port) < 2)) port += 2;
  return port;
}

function AddRtp() {
  const send = useStore((s) => s.send);
  const rtpAvailable = useStore((s) => s.gs?.rtpAvailable ?? false);
  const discovered = useStore((s) => s.gs?.discoveredRtp ?? []);
  const ports = useStore((s) => s.gs?.ports);
  const basePort = useStore((s) => s.gs?.rtpBasePort ?? 5004);
  const suggestedPort = useMemo(() => nextFreeRtpPort(ports ?? [], basePort), [ports, basePort]);
  const [name, setName] = useState("Gateway");
  const [chosenPort, setPort] = useState<number | null>(null); // null = use the suggestion
  const port = chosenPort ?? suggestedPort;
  const [mode, setMode] = useState<"listener" | "initiator">("listener");
  const [host, setHost] = useState("");
  const [rport, setRport] = useState(5004);

  if (!rtpAvailable) return <Empty>RTP-MIDI is not available (module or mDNS failed to load).</Empty>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Session name">
          <TextField value={name} onChange={setName} />
        </Field>
        <Field label="Local port">
          <NumberField value={port} onChange={setPort} min={1} max={65534} />
        </Field>
        <Field label="Mode">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "listener", label: "Listener" },
              { value: "initiator", label: "Initiator" },
            ]}
          />
        </Field>
        {mode === "initiator" && (
          <>
            <Field label="Remote host">
              <TextField value={host} onChange={setHost} placeholder="192.168.1.20" />
            </Field>
            <Field label="Remote port">
              <NumberField value={rport} onChange={setRport} min={1} max={65535} />
            </Field>
          </>
        )}
        <Btn
          variant="primary"
          onClick={async () => {
            const ok = await send({
              kind: "createRtpSession",
              name: name.trim(),
              config: {
                sessionName: name.trim(),
                localPort: port,
                mode,
                remoteHost: mode === "initiator" ? host.trim() || undefined : undefined,
                remotePort: mode === "initiator" ? rport : undefined,
              },
            });
            if (ok) setPort(null); // next session gets the next free port
          }}
        >
          Create RTP session
        </Btn>
      </div>
      {discovered.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Discovered on the network</div>
          <div className="flex flex-wrap gap-2">
            {discovered.map((d) => (
              <button
                key={`${d.address}:${d.port}`}
                onClick={() => {
                  setMode("initiator");
                  setHost(d.address);
                  setRport(d.port);
                  setName(d.name || name);
                }}
                className="rounded border border-line bg-panel-2 px-2 py-1 text-[12px] hover:border-accent"
              >
                {d.name} · {d.address}:{d.port}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function PortsView() {
  const ports = useStore((s) => s.gs?.ports ?? []);
  const backend = useStore((s) => s.gs?.midiBackend ?? "rtmidi");

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      {backend === "null" && (
        <div className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] text-warn">
          Native MIDI backend unavailable — hardware and virtual ports are disabled. The UI still works for
          building presets.
        </div>
      )}

      <Panel title={`Configured ports (${ports.length})`}>
        {ports.length === 0 ? (
          <Empty>No ports yet. Create a virtual port or add a hardware one below.</Empty>
        ) : (
          <div className="flex flex-col gap-1.5">
            {ports.map((p) => (
              <PortRow key={p.id} port={p} />
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Add virtual port">
        <AddVirtual />
      </Panel>
      <Panel title="Add hardware / OS port">
        <AddHardware />
      </Panel>
      <Panel title="Network MIDI (RTP-MIDI / AppleMIDI)">
        <AddRtp />
      </Panel>
    </div>
  );
}
