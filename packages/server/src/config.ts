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

/** False when config.json could not be parsed: leave the user's file alone. */
let persist = true;

export function defaultConfig(): ServerConfig {
  return {
    presetsDir: join(DATA_DIR, "presets"),
    activePreset: null,
    httpPort: 4666,
    host: "127.0.0.1",
    rtp: { basePort: 5004, bonjour: true },
  };
}

/** Expand a leading `~` so hand-written paths like `~/Music/presets` work. */
function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p;
}

/** Keep only well-typed values from a hand-edited config; fall back to defaults otherwise. */
function sanitizeConfig(raw: unknown, defaults: ServerConfig): ServerConfig {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const rtp = (typeof r.rtp === "object" && r.rtp !== null ? r.rtp : {}) as Record<string, unknown>;
  const str = (v: unknown, d: string) => (typeof v === "string" && v.trim() ? v : d);
  const port = (v: unknown, d: number) => (Number.isInteger(v) && (v as number) > 0 && (v as number) < 65536 ? (v as number) : d);
  return {
    presetsDir: expandHome(str(r.presetsDir, defaults.presetsDir)),
    activePreset: typeof r.activePreset === "string" ? r.activePreset : null,
    httpPort: port(r.httpPort, defaults.httpPort),
    host: str(r.host, defaults.host),
    rtp: {
      basePort: port(rtp.basePort, defaults.rtp.basePort),
      bonjour: typeof rtp.bonjour === "boolean" ? rtp.bonjour : defaults.rtp.bonjour,
    },
  };
}

export async function loadConfig(): Promise<ServerConfig> {
  await mkdir(DATA_DIR, { recursive: true });
  const defaults = defaultConfig();
  let cfg = defaults;
  let text: string | null = null;
  try {
    text = await readFile(CONFIG_FILE, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  if (text === null) {
    await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  } else {
    try {
      cfg = sanitizeConfig(JSON.parse(text), defaults);
    } catch (err) {
      // Never overwrite a config the user is editing: run on defaults and say why.
      persist = false;
      console.warn(
        `[config] ${CONFIG_FILE} is not valid JSON (${(err as Error).message}); using defaults and not saving over it.`,
      );
    }
  }
  await mkdir(cfg.presetsDir, { recursive: true });
  return cfg;
}

export async function saveConfig(cfg: ServerConfig): Promise<void> {
  if (!persist) return;
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}
