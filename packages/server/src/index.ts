import { emptyPreset, type Preset } from "@midi-gateway/engine";
import { loadConfig, saveConfig } from "./config.js";
import { createBackend } from "./midi/backend.js";
import { createRtpBackend } from "./midi/rtp.js";
import { PortRegistry } from "./midi/ports.js";
import { Telemetry } from "./telemetry.js";
import { Router } from "./router.js";
import { PresetStore, presetId } from "./presets.js";
import { GatewayStore } from "./state.js";
import { createHttpServer } from "./http.js";
import { attachWebSocket } from "./ws.js";

const SERVER_VERSION = "0.1.0";

async function main() {
  const config = await loadConfig();

  const backend = await createBackend();
  const rtp = await createRtpBackend({ bonjour: config.rtp.bonjour });
  const registry = new PortRegistry(backend, rtp);
  const telemetry = new Telemetry();
  const router = new Router(registry, telemetry);

  const presets = new PresetStore(config.presetsDir);
  presets.watch();
  const store = new GatewayStore();

  // Pick the preset to open (by file id).
  let initial: Preset | null = null;
  if (config.activePreset) {
    initial = await presets.load(config.activePreset).catch(() => null);
    if (initial) config.activePreset = presetId(config.activePreset);
  }
  if (!initial) {
    for (const candidate of await presets.list()) {
      initial = await presets.load(candidate.name).catch(() => null);
      if (initial) {
        config.activePreset = candidate.name;
        break;
      }
    }
  }
  if (!initial) {
    initial = emptyPreset("Default");
    // Don't clobber an unreadable Default.json the user may want to fix.
    const id = (await presets.exists("Default")) ? `Default ${Date.now()}` : "Default";
    config.activePreset = await presets.save(initial, id);
  }
  await saveConfig(config);

  const app = await createHttpServer(config);
  await app.listen({ port: config.httpPort, host: config.host });

  const syncRuntime = () => {
    // Router first: it releases held notes on ports the registry is about to close.
    router.setPreset(store.preset);
    registry.syncFromPreset(store.preset);
  };
  const ws = attachWebSocket({
    server: app.server,
    config,
    serverVersion: SERVER_VERSION,
    store,
    presets,
    router,
    registry,
    telemetry,
    syncRuntime,
  });

  store.on("preset", () => {
    syncRuntime();
    ws.broadcastState();
  });
  store.loadPreset(initial, config.activePreset ?? presetId(initial.name), false);

  // Pick up MIDI devices plugged in / unplugged while running.
  const hotplugTimer = setInterval(() => {
    try {
      if (registry.refreshHardware()) ws.broadcastState();
    } catch (err) {
      console.warn(`[ports] refresh failed: ${(err as Error).message}`);
    }
  }, 2000);

  console.log(`
  MIDI Gateway   http://${config.host}:${config.httpPort}
  midi backend:  ${registry.backendKind}${registry.backendKind === "null" ? "  (no hardware/virtual ports)" : ""}
  rtp-midi:      ${registry.rtpAvailable ? "available" : "disabled"}
  presets:       ${config.presetsDir}
`);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nshutting down…");
    // Hard exit if something hangs (e.g. a client that never closes its socket).
    setTimeout(() => process.exit(0), 3000).unref();
    clearInterval(hotplugTimer);
    try {
      router.dispose(); // note-offs for everything still sounding, while ports are open
      registry.dispose();
      await ws.close();
      await app.close();
      await presets.close();
    } catch (err) {
      console.error(err);
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
