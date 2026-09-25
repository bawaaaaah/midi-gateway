/** WebSocket transport: state snapshots/patches, monitor + activity streams, commands. */
import type { IncomingMessage, Server } from "node:http";
import { execFile } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";
import {
  clientMessageSchema,
  type Command,
  type GatewayState,
  type MonitorFilter,
  type PresetSummary,
  type ServerMessage,
} from "@midi-gateway/engine";
import { saveConfig, type ServerConfig } from "./config.js";
import type { GatewayStore } from "./state.js";
import { presetId, type PresetStore } from "./presets.js";
import type { Router } from "./router.js";
import type { PortRegistry } from "./midi/ports.js";
import { Telemetry } from "./telemetry.js";

const MONITOR_FLUSH_MS = 16;
const ACTIVITY_MS = 33;
const LEARN_PUSH_MS = 200;
/** Skip live-stream frames for a client that is this far behind (slow link / background tab). */
const MAX_BUFFERED_BYTES = 1 << 20;

const LOOPBACK_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)$/i;

/** Hostname part of a Host header (`[::1]:4666` -> `[::1]`, `localhost:4666` -> `localhost`). */
function hostnameOf(host: string): string {
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : (host.split(":")[0] ?? "");
}

/**
 * Browsers let any web page open a WebSocket to 127.0.0.1, so without checks a
 * malicious site could drive the gateway (send MIDI, delete presets...).
 * Accept only same-origin browser connections (or non-browser clients, which
 * send no Origin), and - when bound to loopback - only loopback Host headers,
 * which also defeats DNS rebinding.
 */
function isAllowedClient(req: IncomingMessage, origin: string | undefined, bindHost: string): boolean {
  const host = req.headers.host ?? "";
  if (LOOPBACK_HOST.test(bindHost) && !LOOPBACK_HOST.test(hostnameOf(host))) return false;
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Open a folder in the OS file manager, without going through a shell. */
function revealInFileManager(dir: string): void {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  execFile(opener, [dir], (err) => {
    // explorer.exe exits with 1 even on success.
    if (err && process.platform !== "win32") console.warn(`[presets] could not open ${dir}: ${err.message}`);
  });
}

type Channel = "monitor" | "activity" | "learn";

interface Conn {
  socket: WebSocket;
  channels: Set<Channel>;
  monitorFilter?: MonitorFilter;
}

export interface WsDeps {
  server: Server;
  config: ServerConfig;
  serverVersion: string;
  store: GatewayStore;
  presets: PresetStore;
  router: Router;
  registry: PortRegistry;
  telemetry: Telemetry;
  /** Re-open ports + rebuild chains after the preset changed. */
  syncRuntime(): void;
}

export function attachWebSocket(deps: WsDeps) {
  const { server, config, serverVersion, store, presets, router, registry, telemetry } = deps;
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 4 << 20,
    verifyClient: ({ req, origin }: { req: IncomingMessage; origin?: string }) =>
      isAllowedClient(req, origin, config.host),
  });
  const conns = new Set<Conn>();
  let presetList: PresetSummary[] = [];

  const refreshPresetList = async () => {
    presetList = await presets.list();
  };
  void refreshPresetList().then(broadcastState);
  presets.on("changed", () => {
    void refreshPresetList()
      .then(broadcastState)
      .catch((err: Error) => console.warn(`[presets] refresh failed: ${err.message}`));
  });

  /** Remember the open preset so the next start re-opens it. */
  const persistActivePreset = () => {
    config.activePreset = store.activePresetName;
    saveConfig(config).catch((err: Error) => console.warn(`[config] save failed: ${err.message}`));
  };

  function buildState(): GatewayState {
    const unconfigured = registry.unconfigured(store.preset);
    return {
      serverVersion,
      presetsDir: config.presetsDir,
      activePresetName: store.activePresetName,
      dirty: store.dirty,
      preset: store.preset,
      ports: registry.runtimePorts(),
      learn: router.learnState(),
      presetList,
      availableInputs: unconfigured.inputs,
      availableOutputs: unconfigured.outputs,
      discoveredRtp: registry.discoveredRtp(),
      rtpAvailable: registry.rtpAvailable,
      midiBackend: registry.backendKind === "null" ? "null" : "rtmidi",
    };
  }

  const send = (c: Conn, msg: ServerMessage) => {
    if (c.socket.readyState === WebSocket.OPEN) c.socket.send(JSON.stringify(msg));
  };
  /** For high-rate streams: drop the frame rather than queue it for a client that can't keep up. */
  const sendLive = (c: Conn, msg: ServerMessage) => {
    if (c.socket.bufferedAmount <= MAX_BUFFERED_BYTES) send(c, msg);
  };
  const broadcast = (msg: ServerMessage) => {
    const raw = JSON.stringify(msg);
    for (const c of conns) if (c.socket.readyState === WebSocket.OPEN) c.socket.send(raw);
  };

  function broadcastState() {
    broadcast({ type: "state", state: buildState() });
  }

  wss.on("connection", (socket) => {
    const c: Conn = { socket, channels: new Set() };
    conns.add(c);
    send(c, { type: "hello", serverVersion, presetsDir: config.presetsDir });
    send(c, { type: "state", state: buildState() });

    socket.on("message", (data) => {
      let parsed: ReturnType<typeof clientMessageSchema.safeParse>;
      try {
        parsed = clientMessageSchema.safeParse(JSON.parse(String(data)));
      } catch {
        return send(c, { type: "error", message: "invalid JSON" });
      }
      if (!parsed.success) {
        return send(c, { type: "error", message: parsed.error.issues[0]?.message ?? "bad message" });
      }
      const msg = parsed.data;

      if (msg.type === "ping") return send(c, { type: "pong", t: msg.t });
      if (msg.type === "subscribe") {
        c.channels = new Set(msg.channels);
        c.monitorFilter = msg.monitorFilter as MonitorFilter | undefined;
        if (c.channels.has("learn")) send(c, { type: "learn", observations: router.learnObservations() });
        return;
      }
      // msg.type === "command"
      handleCommand(c, msg.ref, msg.command).catch((err: Error) => console.error("[ws] command:", err));
    });

    socket.on("close", () => conns.delete(c));
    socket.on("error", () => conns.delete(c));
  });

  async function handleCommand(c: Conn, ref: string, cmd: Command) {
    const reply = (ok: boolean, message?: string) =>
      send(c, { type: "commandResult", ref, ok, message });

    try {
      // Structural preset mutations.
      const structural = store.applyStructural(cmd);
      if (structural.handled) return reply(structural.ok, structural.message);

      switch (cmd.kind) {
        case "learnStart":
          router.learnStart(cmd.routeId);
          broadcastState();
          return reply(true);
        case "learnStop":
          router.learnStop();
          broadcastState();
          return reply(true);
        case "learnClear":
          router.learnClear();
          broadcast({ type: "learn", observations: [] });
          return reply(true);

        case "savePreset": {
          // With a name: "save as" a new file. Without: save to the open file
          // (or, if it has none - deleted, never saved - to one named after the preset).
          const id = cmd.name ? presetId(cmd.name) : (store.activePresetName ?? presetId(store.preset.name));
          if (id !== store.activePresetName && (await presets.exists(id))) {
            return reply(false, `a preset file "${id}.json" already exists`);
          }
          if (cmd.name) store.preset.name = cmd.name;
          await presets.save(store.preset, id);
          store.activePresetName = id;
          store.dirty = false;
          persistActivePreset();
          await refreshPresetList();
          broadcastState();
          return reply(true, `saved "${id}.json"`);
        }
        case "loadPreset": {
          const p = await presets.load(cmd.name);
          store.loadPreset(p, presetId(cmd.name), false);
          persistActivePreset();
          return reply(true);
        }
        case "newPreset": {
          const { id, preset } = await presets.create(cmd.name);
          await refreshPresetList();
          store.loadPreset(preset, id, false);
          persistActivePreset();
          return reply(true);
        }
        case "duplicatePreset": {
          const id = cmd.from ? await presets.duplicate(cmd.from, cmd.to) : await presets.saveCopy(store.preset, cmd.to);
          await refreshPresetList();
          broadcastState();
          return reply(true, `copied to "${id}.json"`);
        }
        case "deletePreset": {
          await presets.remove(cmd.name);
          if (store.activePresetName === presetId(cmd.name)) {
            store.activePresetName = null;
            store.dirty = true;
            persistActivePreset();
          }
          await refreshPresetList();
          broadcastState();
          return reply(true);
        }
        case "revealPresets": {
          revealInFileManager(config.presetsDir);
          return reply(true);
        }

        case "panic": {
          router.panic(cmd.routeId);
          return reply(true);
        }
        default:
          return reply(false, `unhandled command`);
      }
    } catch (err) {
      return reply(false, (err as Error).message);
    }
  }

  // Live streams -----------------------------------------------------------

  const monitorTimer = setInterval(() => {
    const batch = telemetry.drainMonitor();
    if (batch.length === 0) return;
    for (const c of conns) {
      if (!c.channels.has("monitor")) continue;
      const events = batch.filter((m) => Telemetry.matchesFilter(m, c.monitorFilter));
      if (events.length) sendLive(c, { type: "monitor", events });
    }
  }, MONITOR_FLUSH_MS);

  const activityTimer = setInterval(() => {
    telemetry.setPortRates(registry.pollRates());
    const anyone = [...conns].some((c) => c.channels.has("activity"));
    if (!anyone) return;
    const activity = telemetry.activitySnapshot();
    for (const c of conns) if (c.channels.has("activity")) sendLive(c, { type: "activity", activity });
  }, ACTIVITY_MS);

  const learnTimer = setInterval(() => {
    if (!router.learnState().active) return;
    const observations = router.learnObservations();
    for (const c of conns) if (c.channels.has("learn")) sendLive(c, { type: "learn", observations });
  }, LEARN_PUSH_MS);

  // Port availability + RTP discovery change without a command; refresh slowly.
  const refreshTimer = setInterval(() => {
    if (conns.size) broadcastState();
  }, 3000);

  return {
    broadcastState,
    async close() {
      clearInterval(monitorTimer);
      clearInterval(activityTimer);
      clearInterval(learnTimer);
      clearInterval(refreshTimer);
      for (const c of conns) c.socket.close();
      await new Promise<void>((res) => wss.close(() => res()));
    },
  };
}
