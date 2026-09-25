/**
 * Unified registry of every live port - hardware (via {@link MidiBackend}),
 * virtual (CoreMIDI/ALSA), and RTP-MIDI network sessions. Reconciles itself
 * against the active preset and emits normalised {@link MidiEvent}s.
 */
import { EventEmitter } from "node:events";
import { parse, serialize, type MidiEvent, type Port, type Preset } from "@midi-gateway/engine";
import type { PortDirection, RuntimePort } from "@midi-gateway/engine";
import type { MidiBackend, RawInput, RawOutput } from "./backend.js";
import type { RtpBackend, RtpPortHandle } from "./rtp.js";

const now = () => performance.now();

function directionOf(kind: Port["kind"]): PortDirection {
  switch (kind) {
    case "hw-in":
    case "virtual-in":
      return "in";
    case "hw-out":
    case "virtual-out":
      return "out";
    case "rtp":
      return "bidir";
  }
}

function signatureOf(p: Port): string {
  return JSON.stringify([p.kind, p.systemName ?? p.name, p.rtp ?? null]);
}

interface LivePort {
  port: Port;
  signature: string;
  direction: PortDirection;
  available: boolean;
  connected: boolean;
  input?: RawInput | RtpPortHandle;
  output?: RawOutput | RtpPortHandle;
  /** Set for `rtp` ports (same handle as input/output). */
  rtp?: RtpPortHandle;
  inCount: number;
  outCount: number;
}

const isHardware = (p: Port) => p.kind === "hw-in" || p.kind === "hw-out";
const matchesSystemName = (osName: string, wanted: string) => osName === wanted || osName.includes(wanted);

export interface PortRegistryEvents {
  event: [portId: string, ev: MidiEvent];
}

export class PortRegistry extends EventEmitter {
  private live = new Map<string, LivePort>();
  private lastRatePoll = now();

  constructor(
    private backend: MidiBackend,
    private rtp: RtpBackend,
  ) {
    super();
  }

  get backendKind(): string {
    return this.backend.kind;
  }
  get rtpAvailable(): boolean {
    return this.rtp.available;
  }

  syncFromPreset(preset: Preset): void {
    const wanted = new Map(preset.ports.map((p) => [p.id, p]));

    for (const [id, lp] of this.live) {
      const next = wanted.get(id);
      if (!next || signatureOf(next) !== lp.signature) {
        this.teardown(lp);
        this.live.delete(id);
      }
    }

    for (const port of preset.ports) {
      if (this.live.has(port.id)) {
        this.live.get(port.id)!.port = port; // name-only change
        continue;
      }
      this.live.set(port.id, this.build(port));
    }
  }

  private build(port: Port): LivePort {
    const lp: LivePort = {
      port,
      signature: signatureOf(port),
      direction: directionOf(port.kind),
      available: false,
      connected: false,
      inCount: 0,
      outCount: 0,
    };
    this.open(lp);
    return lp;
  }

  private open(lp: LivePort): void {
    const port = lp.port;
    try {
      switch (port.kind) {
        case "hw-in": {
          const h = this.backend.openInput(port.systemName ?? port.name);
          if (h) this.wireInput(lp, h);
          lp.available = lp.connected = !!h;
          break;
        }
        case "hw-out": {
          const h = this.backend.openOutput(port.systemName ?? port.name);
          lp.output = h ?? undefined;
          lp.available = lp.connected = !!h;
          break;
        }
        case "virtual-in": {
          const h = this.backend.openVirtualInput(port.name);
          this.wireInput(lp, h);
          lp.available = lp.connected = true;
          break;
        }
        case "virtual-out": {
          lp.output = this.backend.openVirtualOutput(port.name);
          lp.available = lp.connected = true;
          break;
        }
        case "rtp": {
          if (port.rtp) {
            const h = this.rtp.createSession(port.rtp);
            this.wireInput(lp, h);
            lp.output = h;
            lp.rtp = h;
            lp.available = this.rtp.available;
          }
          break;
        }
      }
    } catch (err) {
      console.warn(`[ports] failed to open ${port.name}: ${(err as Error).message}`);
    }
  }

  /**
   * RtMidi does not notice a device being unplugged or plugged back in: re-open
   * hardware ports whose device (re)appeared and drop the ones that vanished.
   * Call it periodically.
   * @returns true when a port's availability changed.
   */
  refreshHardware(): boolean {
    const hw = [...this.live.values()].filter((lp) => isHardware(lp.port));
    if (hw.length === 0) return false;
    const inputs = this.backend.listInputs();
    const outputs = this.backend.listOutputs();
    let changed = false;
    for (const lp of hw) {
      const wanted = lp.port.systemName ?? lp.port.name;
      const present = (lp.port.kind === "hw-in" ? inputs : outputs).some((n) => matchesSystemName(n, wanted));
      if (present === lp.available) continue;
      this.teardown(lp);
      if (present) this.open(lp);
      // A device that shows up but still can't be opened stays "offline": no change.
      if (lp.available === present) changed = true;
    }
    return changed;
  }

  private wireInput(lp: LivePort, h: RawInput | RtpPortHandle): void {
    lp.input = h;
    h.onMessage((bytes) => {
      if (!bytes || bytes.length === 0) return;
      const ev = parse(bytes, { t: now(), sourceId: lp.port.id });
      lp.inCount++;
      this.emit("event", lp.port.id, ev);
    });
  }

  private teardown(lp: LivePort): void {
    try {
      lp.input?.close();
    } catch {
      /* ignore */
    }
    try {
      if (lp.output && lp.output !== lp.input) lp.output.close();
    } catch {
      /* ignore */
    }
    lp.input = lp.output = lp.rtp = undefined;
    lp.available = lp.connected = false;
  }

  send(portId: string, ev: MidiEvent): void {
    const lp = this.live.get(portId);
    if (!lp?.output) return;
    lp.output.send(serialize(ev));
    lp.outCount++;
  }

  /** All-sound-off + all-notes-off on every channel. */
  allNotesOff(portId: string): void {
    const lp = this.live.get(portId);
    if (!lp?.output) return;
    for (let ch = 0; ch < 16; ch++) {
      lp.output.send([0xb0 | ch, 120, 0]); // all sound off
      lp.output.send([0xb0 | ch, 123, 0]); // all notes off
    }
  }

  runtimePorts(): RuntimePort[] {
    return [...this.live.values()].map((lp) => ({
      ...lp.port,
      direction: lp.direction,
      available: lp.available,
      connected: lp.rtp ? lp.available && lp.rtp.hasPeer() : lp.connected,
    }));
  }

  /** OS ports the preset does not reference yet, for the "add port" picker. */
  unconfigured(preset: Preset): { inputs: string[]; outputs: string[] } {
    const usedIn = preset.ports.filter((p) => p.kind === "hw-in").map((p) => p.systemName ?? p.name);
    const usedOut = preset.ports.filter((p) => p.kind === "hw-out").map((p) => p.systemName ?? p.name);
    return {
      inputs: this.backend.listInputs().filter((n) => !usedIn.includes(n) && !isOwnVirtual(n, preset)),
      outputs: this.backend.listOutputs().filter((n) => !usedOut.includes(n) && !isOwnVirtual(n, preset)),
    };
  }

  discoveredRtp() {
    return this.rtp.discovered();
  }

  /** msg/s per port since the previous call, plus a 0..1 rolling level. */
  pollRates(): Record<string, { level: number; inRate: number; outRate: number }> {
    const t = now();
    const dt = Math.max(1, t - this.lastRatePoll) / 1000;
    this.lastRatePoll = t;
    const out: Record<string, { level: number; inRate: number; outRate: number }> = {};
    for (const [id, lp] of this.live) {
      const inRate = lp.inCount / dt;
      const outRate = lp.outCount / dt;
      lp.inCount = 0;
      lp.outCount = 0;
      out[id] = { inRate, outRate, level: Math.min(1, (inRate + outRate) / 40) };
    }
    return out;
  }

  dispose(): void {
    for (const lp of this.live.values()) this.teardown(lp);
    this.live.clear();
  }
}

function isOwnVirtual(name: string, preset: Preset): boolean {
  return preset.ports.some((p) => (p.kind === "virtual-in" || p.kind === "virtual-out") && p.name === name);
}
