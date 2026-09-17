import type {
  ActivitySnapshot,
  ClientMessage,
  Command,
  GatewayState,
  LearnObservation,
  MonitorEvent,
  MonitorFilter,
  ServerMessage,
} from "@midi-gateway/engine";

export interface ClientStatus {
  connected: boolean;
  latencyMs: number | null;
}

type Handlers = {
  state(s: GatewayState): void;
  monitor(events: MonitorEvent[]): void;
  activity(a: ActivitySnapshot): void;
  learn(obs: LearnObservation[]): void;
  status(s: ClientStatus): void;
};

const PING_MS = 4000;

export class GatewayClient {
  private ws: WebSocket | null = null;
  private backoff = 500;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastPingSent = 0;
  private latencyMs: number | null = null;

  private channels: ("monitor" | "activity" | "learn")[] = ["monitor", "activity", "learn"];
  private monitorFilter: MonitorFilter | undefined;

  private cmdSeq = 0;
  private pending = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();

  readonly on: Partial<Handlers> = {};

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => this.handleOpen();
    this.ws.onmessage = (e) => this.handleMessage(e.data);
    this.ws.onclose = () => this.handleClose();
    this.ws.onerror = () => this.ws?.close();
  }

  private handleOpen(): void {
    this.backoff = 500;
    this.emitStatus(true);
    this.subscribe();
    this.startPing();
  }

  private handleClose(): void {
    this.stopPing();
    this.emitStatus(false);
    for (const p of this.pending.values()) p.reject(new Error("disconnected"));
    this.pending.clear();
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.backoff);
    this.backoff = Math.min(this.backoff * 1.7, 8000);
  }

  private handleMessage(data: unknown): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(data)) as ServerMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case "state":
        this.on.state?.(msg.state);
        break;
      case "monitor":
        this.on.monitor?.(msg.events);
        break;
      case "activity":
        this.on.activity?.(msg.activity);
        break;
      case "learn":
        this.on.learn?.(msg.observations);
        break;
      case "pong":
        this.latencyMs = Math.round(performance.now() - this.lastPingSent);
        this.emitStatus(true);
        break;
      case "commandResult": {
        const p = this.pending.get(msg.ref);
        if (p) {
          this.pending.delete(msg.ref);
          msg.ok ? p.resolve() : p.reject(new Error(msg.message ?? "command failed"));
        }
        break;
      }
      case "error":
        console.warn("[gateway] server error:", msg.message);
        break;
    }
  }

  private raw(m: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private subscribe(): void {
    this.raw({ type: "subscribe", channels: this.channels, monitorFilter: this.monitorFilter });
  }

  setSubscription(channels: ("monitor" | "activity" | "learn")[], monitorFilter?: MonitorFilter): void {
    this.channels = channels;
    this.monitorFilter = monitorFilter;
    this.subscribe();
  }

  send(command: Command): Promise<void> {
    const ref = `c${++this.cmdSeq}`;
    return new Promise<void>((resolve, reject) => {
      if (this.ws?.readyState !== WebSocket.OPEN) return reject(new Error("not connected"));
      this.pending.set(ref, { resolve, reject });
      this.raw({ type: "command", ref, command });
      setTimeout(() => {
        if (this.pending.delete(ref)) reject(new Error("command timed out"));
      }, 5000);
    });
  }

  private startPing(): void {
    this.stopPing();
    const beat = () => {
      this.lastPingSent = performance.now();
      this.raw({ type: "ping", t: this.lastPingSent });
    };
    beat();
    this.pingTimer = setInterval(beat, PING_MS);
  }
  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private emitStatus(connected: boolean): void {
    this.on.status?.({ connected, latencyMs: connected ? this.latencyMs : null });
  }
}

export const gateway = new GatewayClient();
