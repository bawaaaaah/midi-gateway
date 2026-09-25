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
  /** At least one remote peer is connected to the session. */
  hasPeer(): boolean;
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
  /**
   * With a single argument the library stamps the message with its own clock.
   * (The two-argument form expects an absolute timestamp in its internal units.)
   */
  sendMessage(bytes: number[]): void;
  connect(o: { address: string; port: number }): void;
  getStreams(): unknown[];
  end(): void;
  on(ev: "message", cb: (dt: number, msg: number[]) => void): void;
  on(ev: "error", cb: (err: Error) => void): void;
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

  constructor(
    private manager: RtpManager,
    private bonjour: boolean,
  ) {
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
      published: this.bonjour,
    });
    // UDP socket errors (e.g. EADDRINUSE) are re-emitted as "error" on the
    // session; without a listener Node would throw and kill the gateway.
    session.on("error", (err) => {
      console.warn(`[rtp] session "${cfg.sessionName}" (udp ${cfg.localPort}): ${err.message}`);
    });
    if (cfg.mode === "initiator" && cfg.remoteHost && cfg.remotePort) {
      try {
        session.connect({ address: cfg.remoteHost, port: cfg.remotePort });
      } catch (err) {
        console.warn(`[rtp] connect to ${cfg.remoteHost}:${cfg.remotePort} failed: ${(err as Error).message}`);
      }
    }
    return {
      onMessage: (cb) => session.on("message", (_dt, msg) => cb(Array.from(msg))),
      send: (bytes) => {
        try {
          session.sendMessage(bytes);
        } catch {
          /* no peer */
        }
      },
      hasPeer: () => {
        try {
          return session.getStreams().length > 0;
        } catch {
          return false;
        }
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
      hasPeer: () => false,
      close: () => {},
    };
  }
  discovered(): DiscoveredSession[] {
    return [];
  }
  onDiscovery(): void {}
  dispose(): void {}
}
