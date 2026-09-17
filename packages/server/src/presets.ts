/** Reads / writes preset `.json` files in the presets directory and watches it. */
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { readdir, readFile, writeFile, unlink, stat } from "node:fs/promises";
import chokidar, { type FSWatcher } from "chokidar";
import { emptyPreset, parsePreset, type Preset } from "@midi-gateway/engine";
import type { PresetSummary } from "@midi-gateway/engine";

const sanitize = (name: string) => name.replace(/[^\w\-. ]+/g, "_").trim() || "Untitled";

export class PresetStore extends EventEmitter {
  private watcher?: FSWatcher;

  constructor(readonly dir: string) {
    super();
  }

  fileFor(name: string): string {
    return join(this.dir, `${sanitize(name)}.json`);
  }

  async list(): Promise<PresetSummary[]> {
    let files: string[];
    try {
      files = (await readdir(this.dir)).filter((f) => f.endsWith(".json"));
    } catch {
      return [];
    }
    const out: PresetSummary[] = [];
    for (const file of files) {
      const full = join(this.dir, file);
      try {
        const [st, preset] = await Promise.all([
          stat(full),
          readFile(full, "utf8").then((r) => parsePreset(JSON.parse(r))),
        ]);
        out.push({
          name: preset.name || file.replace(/\.json$/, ""),
          file,
          updatedAt: st.mtimeMs,
          routeCount: preset.routes.length,
        });
      } catch {
        out.push({ name: file.replace(/\.json$/, ""), file, updatedAt: 0, routeCount: -1 });
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async load(name: string): Promise<Preset> {
    const raw = await readFile(this.fileFor(name), "utf8");
    return parsePreset(JSON.parse(raw));
  }

  async save(preset: Preset): Promise<void> {
    // Validate before writing so we never persist a broken preset.
    const clean = parsePreset(JSON.parse(JSON.stringify(preset)));
    await writeFile(this.fileFor(clean.name), JSON.stringify(clean, null, 2));
  }

  async create(name: string): Promise<Preset> {
    const p = emptyPreset(sanitize(name));
    await this.save(p);
    return p;
  }

  async duplicate(from: string, to: string): Promise<Preset> {
    const src = await this.load(from);
    const copy: Preset = { ...src, name: sanitize(to) };
    await this.save(copy);
    return copy;
  }

  async remove(name: string): Promise<void> {
    await unlink(this.fileFor(name));
  }

  /** Emits `"changed"` (debounced) whenever a file in the dir is added/edited/removed. */
  watch(): void {
    if (this.watcher) return;
    let timer: NodeJS.Timeout | undefined;
    const ping = () => {
      clearTimeout(timer);
      timer = setTimeout(() => this.emit("changed"), 150);
    };
    this.watcher = chokidar
      .watch(this.dir, { ignoreInitial: true, depth: 0, awaitWriteFinish: { stabilityThreshold: 120 } })
      .on("add", ping)
      .on("change", ping)
      .on("unlink", ping);
  }

  async close(): Promise<void> {
    await this.watcher?.close();
  }
}
