/**
 * Network MIDI (AppleMIDI / RTP-MIDI) via `@somesmall.studio/rtpmidi`.
 * Optional: if the module or mDNS is unavailable the gateway keeps running
 * without network sessions.
 */
import type { RtpSessionConfig } from "@midi-gateway/engine";

export interface DiscoveredSession {
  name: string;
  address: string;
  port: number;
}

export interface RtpPortHandle {
  onMessage(cb: (bytes: number[]) => void): void;
  send(bytes: number[]): void;
  connect(host: string, port: number): void;
  disconnect(): void;
  close(): void;
}

export interface RtpBackend {
  readonly available: boolean;
  createSession(cfg: RtpSessionConfig): RtpPortHandle;
  discovered(): DiscoveredSession[];
  onDiscovery(cb: () => void): void;
  dispose(): void;
}

export async function createRtpBackend(opts: { bonjour: boolean }): Promise<RtpBackend> {
  try {
    const mod = await import("@somesmall.studio/rtpmidi");
    const manager = (mod as { default?: { manager?: unknown }; manager?: unknown }).manager ??
      (mod as { default?: { manager?: unknown } }).default?.manager;
    if (!manager) throw new Error("no manager export");
    return new RealRtpBackend(manager as RtpManager, opts.bonjour);
  } catch (err) {
    console.warn(`[rtp] network MIDI disabled: ${(err as Error).message}`);
    return new NullRtpBackend();
  }
}

interface RtpSession {
  name: string;
  port: number;
  sendMessage(dt: number, bytes: number[]): void;
  connect(o: { address: string; port: number }): void;
  end(): void;
  on(ev: "message", cb: (dt: number, msg: number[]) => void): void;
}
interface RtpManager {
  createSession(o: { localName: string; bonjourName: string; port: number; published: boolean }): RtpSession;
  removeSession(s: RtpSession): void;
  startDiscovery(): void;
  on(ev: string, cb: (e: { remoteSession: DiscoveredSession }) => void): void;
}

class RealRtpBackend implements RtpBackend {
  readonly available = true;
  private seen = new Map<string, DiscoveredSession>();
  private discoveryCbs: (() => void)[] = [];

  constructor(private manager: RtpManager, bonjour: boolean) {
    if (bonjour) {
      try {
        this.manager.startDiscovery();
        this.manager.on("remoteSessionAdded", ({ remoteSession }) => {
          this.seen.set(`${remoteSession.address}:${remoteSession.port}`, remoteSession);
          this.discoveryCbs.forEach((cb) => cb());
        });
        this.manager.on("remoteSessionRemoved", ({ remoteSession }) => {
          this.seen.delete(`${remoteSession.address}:${remoteSession.port}`);
          this.discoveryCbs.forEach((cb) => cb());
        });
      } catch (err) {
        console.warn(`[rtp] discovery unavailable: ${(err as Error).message}`);
      }
    }
  }

  createSession(cfg: RtpSessionConfig): RtpPortHandle {
    const session = this.manager.createSession({
      localName: cfg.sessionName,
      bonjourName: cfg.sessionName,
      port: cfg.localPort,
      published: true,
    });
    if (cfg.mode === "initiator" && cfg.remoteHost && cfg.remotePort) {
      session.connect({ address: cfg.remoteHost, port: cfg.remotePort });
    }
    return {
      onMessage: (cb) => session.on("message", (_dt, msg) => cb(msg)),
      send: (bytes) => {
        try {
          session.sendMessage(0, bytes);
        } catch {
          /* no peer */
        }
      },
      connect: (address, port) => session.connect({ address, port }),
      disconnect: () => {
        /* fork lacks a per-peer disconnect; recreate the session to drop peers */
      },
      close: () => {
        try {
          this.manager.removeSession(session);
          session.end();
        } catch {
          /* already gone */
        }
      },
    };
  }

  discovered(): DiscoveredSession[] {
    return [...this.seen.values()];
  }
  onDiscovery(cb: () => void): void {
    this.discoveryCbs.push(cb);
  }
  dispose(): void {}
}

class NullRtpBackend implements RtpBackend {
  readonly available = false;
  createSession(): RtpPortHandle {
    return {
      onMessage: () => {},
      send: () => {},
      connect: () => {},
      disconnect: () => {},
      close: () => {},
    };
  }
  discovered(): DiscoveredSession[] {
    return [];
  }
  onDiscovery(): void {}
  dispose(): void {}
}
