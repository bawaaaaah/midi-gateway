/** WebSocket transport: state snapshots/patches, monitor + activity streams, commands. */
import type { Server } from "node:http";
import { exec } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";
import {
  clientMessageSchema,
  type Command,
  type GatewayState,
  type MonitorFilter,
  type PresetSummary,
  type ServerMessage,
} from "@midi-gateway/engine";
import type { ServerConfig } from "./config.js";
import type { GatewayStore } from "./state.js";
import type { PresetStore } from "./presets.js";
import type { Router } from "./router.js";
import type { PortRegistry } from "./midi/ports.js";
import { Telemetry } from "./telemetry.js";

const MONITOR_FLUSH_MS = 16;
const ACTIVITY_MS = 33;
const LEARN_PUSH_MS = 200;

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
  const wss = new WebSocketServer({ server, path: "/ws" });
  const conns = new Set<Conn>();
  let presetList: PresetSummary[] = [];

  const refreshPresetList = async () => {
    presetList = await presets.list();
  };
  void refreshPresetList();
  presets.on("changed", () => {
    void refreshPresetList().then(broadcastState);
  });

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
      void handleCommand(c, msg.ref, msg.command);
    });

    socket.on("close", () => conns.delete(c));
    socket.on("error", () => conns.delete(c));
  });

  async function handleCommand(c: Conn, ref: string, cmd: Command) {
    const reply = (ok: boolean, message?: string) =>
      send(c, { type: "commandResult", ref, ok, message });

    // Structural preset mutations.
    const structural = store.applyStructural(cmd);
    if (structural.handled) return reply(structural.ok, structural.message);

    try {
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
          if (cmd.name && cmd.name !== store.preset.name) store.preset.name = cmd.name;
          await presets.save(store.preset);
          store.activePresetName = store.preset.name;
          store.dirty = false;
          await refreshPresetList();
          broadcastState();
          return reply(true, `saved "${store.preset.name}"`);
        }
        case "loadPreset": {
          const p = await presets.load(cmd.name);
          store.loadPreset(p, cmd.name, false);
          return reply(true);
        }
        case "newPreset": {
          const p = await presets.create(cmd.name);
          store.loadPreset(p, p.name, false);
          await refreshPresetList();
          return reply(true);
        }
        case "duplicatePreset": {
          await presets.duplicate(cmd.from, cmd.to);
          await refreshPresetList();
          broadcastState();
          return reply(true);
        }
        case "deletePreset": {
          await presets.remove(cmd.name);
          if (store.activePresetName === cmd.name) {
            store.activePresetName = null;
            store.dirty = true;
          }
          await refreshPresetList();
          broadcastState();
          return reply(true);
        }
        case "revealPresets": {
          exec(`open ${JSON.stringify(config.presetsDir)}`, () => {});
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
      if (events.length) send(c, { type: "monitor", events });
    }
  }, MONITOR_FLUSH_MS);

  const activityTimer = setInterval(() => {
    telemetry.setPortRates(registry.pollRates());
    const anyone = [...conns].some((c) => c.channels.has("activity"));
    if (!anyone) return;
    const activity = telemetry.activitySnapshot();
    for (const c of conns) if (c.channels.has("activity")) send(c, { type: "activity", activity });
  }, ACTIVITY_MS);

  const learnTimer = setInterval(() => {
    if (!router.learnState().active) return;
    const observations = router.learnObservations();
    for (const c of conns) if (c.channels.has("learn")) send(c, { type: "learn", observations });
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
