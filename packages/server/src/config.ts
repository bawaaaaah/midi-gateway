/** Server configuration, persisted at `~/midi-gateway/config.json`. */
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export interface ServerConfig {
  /** Where preset `.json` files live. */
  presetsDir: string;
  /** Preset to load on start (by name, without extension). */
  activePreset: string | null;
  httpPort: number;
  /** Bind address. 127.0.0.1 keeps it local; 0.0.0.0 exposes it on the LAN. */
  host: string;
  rtp: {
    /** Base UDP control port for new sessions; each session takes base + 2*n. */
    basePort: number;
    /** Advertise sessions over Bonjour/mDNS. */
    bonjour: boolean;
  };
}

export const DATA_DIR = join(homedir(), "midi-gateway");
const CONFIG_FILE = join(DATA_DIR, "config.json");

export function defaultConfig(): ServerConfig {
  return {
    presetsDir: join(DATA_DIR, "presets"),
    activePreset: null,
    httpPort: 4666,
    host: "127.0.0.1",
    rtp: { basePort: 5004, bonjour: true },
  };
}

export async function loadConfig(): Promise<ServerConfig> {
  await mkdir(DATA_DIR, { recursive: true });
  let cfg = defaultConfig();
  try {
    const raw = JSON.parse(await readFile(CONFIG_FILE, "utf8")) as Partial<ServerConfig>;
    cfg = { ...cfg, ...raw, rtp: { ...cfg.rtp, ...(raw.rtp ?? {}) } };
  } catch {
    await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  }
  await mkdir(cfg.presetsDir, { recursive: true });
  return cfg;
}

export async function saveConfig(cfg: ServerConfig): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}
