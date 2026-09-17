import { emptyPreset, type Preset } from "@midi-gateway/engine";
import { loadConfig, saveConfig } from "./config.js";
import { createBackend } from "./midi/backend.js";
import { createRtpBackend } from "./midi/rtp.js";
import { PortRegistry } from "./midi/ports.js";
import { Telemetry } from "./telemetry.js";
import { Router } from "./router.js";
import { PresetStore } from "./presets.js";
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

  // Pick the preset to open.
  let initial: Preset | null = null;
  if (config.activePreset) {
    initial = await presets.load(config.activePreset).catch(() => null);
  }
  if (!initial) {
    const [first] = await presets.list();
    if (first) {
      initial = await presets.load(first.name).catch(() => null);
      if (initial) config.activePreset = first.name;
    }
  }
  if (!initial) {
    initial = emptyPreset("Default");
    await presets.save(initial);
    config.activePreset = "Default";
  }
  await saveConfig(config);

  const app = await createHttpServer(config);
  await app.listen({ port: config.httpPort, host: config.host });

  const syncRuntime = () => {
    registry.syncFromPreset(store.preset);
    router.setPreset(store.preset);
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
  store.loadPreset(initial, config.activePreset ?? initial.name, false);

  console.log(`
  MIDI Gateway   http://${config.host}:${config.httpPort}
  midi backend:  ${registry.backendKind}${registry.backendKind === "null" ? "  (no hardware/virtual ports)" : ""}
  rtp-midi:      ${registry.rtpAvailable ? "available" : "disabled"}
  presets:       ${config.presetsDir}
`);

  const shutdown = async () => {
    console.log("\nshutting down…");
    await ws.close();
    await app.close();
    router.dispose();
    registry.dispose();
    await presets.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
