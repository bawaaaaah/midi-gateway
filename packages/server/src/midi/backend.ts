/**
 * Local MIDI I/O via `@julusian/midi` (RtMidi). If the native module fails to
 * load (e.g. no prebuild for this platform / Node ABI) the gateway falls back
 * to a {@link NullBackend} so the UI still runs - only real ports are missing.
 */

export interface RawInput {
  readonly name: string;
  onMessage(cb: (bytes: number[]) => void): void;
  close(): void;
}

export interface RawOutput {
  readonly name: string;
  send(bytes: number[]): void;
  close(): void;
}

export interface MidiBackend {
  readonly kind: "rtmidi" | "null";
  listInputs(): string[];
  listOutputs(): string[];
  /** Open a hardware input whose OS name equals or contains `systemName`. */
  openInput(systemName: string): RawInput | null;
  openOutput(systemName: string): RawOutput | null;
  openVirtualInput(name: string): RawInput;
  openVirtualOutput(name: string): RawOutput;
  dispose(): void;
}

export async function createBackend(): Promise<MidiBackend> {
  try {
    const mod = await import("@julusian/midi");
    const m = (mod as { default?: unknown }).default ?? mod;
    return new RtMidiBackend(m as RtMidiModule);
  } catch (err) {
    console.warn(
      `[midi] @julusian/midi unavailable - running without hardware/virtual MIDI. (${(err as Error).message})`,
    );
    return new NullBackend();
  }
}

// ---------------------------------------------------------------------------
// RtMidi
// ---------------------------------------------------------------------------

interface RtInput {
  getPortCount(): number;
  getPortName(i: number): string;
  openPort(i: number): void;
  openVirtualPort(name: string): void;
  closePort(): void;
  ignoreTypes(sysex: boolean, timing: boolean, activeSensing: boolean): void;
  on(event: "message", cb: (deltaTime: number, message: number[]) => void): void;
}
interface RtOutput {
  getPortCount(): number;
  getPortName(i: number): string;
  openPort(i: number): void;
  openVirtualPort(name: string): void;
  closePort(): void;
  sendMessage(bytes: number[]): void;
}
interface RtMidiModule {
  Input: new () => RtInput;
  Output: new () => RtOutput;
}

function findPort(count: number, nameAt: (i: number) => string, wanted: string): number {
  for (let i = 0; i < count; i++) if (nameAt(i) === wanted) return i;
  for (let i = 0; i < count; i++) if (nameAt(i).includes(wanted)) return i;
  return -1;
}

class RtMidiBackend implements MidiBackend {
  readonly kind = "rtmidi" as const;
  constructor(private m: RtMidiModule) {}

  private enumerate(make: () => { getPortCount(): number; getPortName(i: number): string }): string[] {
    const probe = make();
    const names: string[] = [];
    for (let i = 0; i < probe.getPortCount(); i++) names.push(probe.getPortName(i));
    return names;
  }

  listInputs(): string[] {
    return this.enumerate(() => new this.m.Input());
  }
  listOutputs(): string[] {
    return this.enumerate(() => new this.m.Output());
  }

  openInput(systemName: string): RawInput | null {
    const inp = new this.m.Input();
    const idx = findPort(inp.getPortCount(), (i) => inp.getPortName(i), systemName);
    if (idx < 0) return null;
    inp.ignoreTypes(false, true, true); // pass sysex, drop timing + active-sensing
    inp.openPort(idx);
    return this.wrapInput(inp, systemName);
  }

  openOutput(systemName: string): RawOutput | null {
    const out = new this.m.Output();
    const idx = findPort(out.getPortCount(), (i) => out.getPortName(i), systemName);
    if (idx < 0) return null;
    out.openPort(idx);
    return this.wrapOutput(out, systemName);
  }

  openVirtualInput(name: string): RawInput {
    const inp = new this.m.Input();
    inp.ignoreTypes(false, true, true);
    inp.openVirtualPort(name);
    return this.wrapInput(inp, name);
  }

  openVirtualOutput(name: string): RawOutput {
    const out = new this.m.Output();
    out.openVirtualPort(name);
    return this.wrapOutput(out, name);
  }

  dispose(): void {
    /* individual ports are closed by the registry */
  }

  private wrapInput(inp: RtInput, name: string): RawInput {
    return {
      name,
      onMessage: (cb) => inp.on("message", (_dt, message) => cb(message)),
      close: () => {
        try {
          inp.closePort();
        } catch {
          /* already closed */
        }
      },
    };
  }

  private wrapOutput(out: RtOutput, name: string): RawOutput {
    return {
      name,
      send: (bytes) => {
        try {
          out.sendMessage(bytes);
        } catch {
          /* port went away */
        }
      },
      close: () => {
        try {
          out.closePort();
        } catch {
          /* already closed */
        }
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Null
// ---------------------------------------------------------------------------

class NullBackend implements MidiBackend {
  readonly kind = "null" as const;
  listInputs(): string[] {
    return [];
  }
  listOutputs(): string[] {
    return [];
  }
  openInput(): RawInput | null {
    return null;
  }
  openOutput(): RawOutput | null {
    return null;
  }
  openVirtualInput(name: string): RawInput {
    return { name, onMessage: () => {}, close: () => {} };
  }
  openVirtualOutput(name: string): RawOutput {
    return { name, send: () => {}, close: () => {} };
  }
  dispose(): void {}
}
