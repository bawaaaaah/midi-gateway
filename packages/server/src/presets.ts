/**
 * Reads / writes preset `.json` files in the presets directory and watches it.
 *
 * A preset is identified by its file name without `.json` (its "id"). The name
 * stored inside the file is only a display title: it may differ from the file
 * name (e.g. the bundled examples), and renaming a preset never moves its file.
 */
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { readdir, readFile, writeFile, unlink, stat, rename, access } from "node:fs/promises";
import chokidar, { type FSWatcher } from "chokidar";
import { emptyPreset, parsePreset, type Preset } from "@midi-gateway/engine";
import type { PresetSummary } from "@midi-gateway/engine";

/** Turn a user-supplied name into a safe file id (no path separators). */
export const presetId = (name: string) => name.replace(/[^\w\-. ]+/g, "_").replace(/^\.+/, "").trim() || "Untitled";

export class PresetStore extends EventEmitter {
  private watcher?: FSWatcher;

  constructor(readonly dir: string) {
    super();
  }

  fileFor(id: string): string {
    return join(this.dir, `${presetId(id)}.json`);
  }

  async exists(id: string): Promise<boolean> {
    try {
      await access(this.fileFor(id));
      return true;
    } catch {
      return false;
    }
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
      const name = file.replace(/\.json$/, "");
      try {
        const [st, preset] = await Promise.all([
          stat(full),
          readFile(full, "utf8").then((r) => parsePreset(JSON.parse(r))),
        ]);
        out.push({ name, title: preset.name || name, file, updatedAt: st.mtimeMs, routeCount: preset.routes.length });
      } catch {
        out.push({ name, title: name, file, updatedAt: 0, routeCount: -1 });
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async load(id: string): Promise<Preset> {
    const raw = await readFile(this.fileFor(id), "utf8");
    return parsePreset(JSON.parse(raw));
  }

  /**
   * Validate and write `preset` to `<id>.json` (default: derived from its name).
   * The write is atomic, so a crash mid-save never leaves a truncated preset.
   * @returns the id it was saved under.
   */
  async save(preset: Preset, id = presetId(preset.name)): Promise<string> {
    // Validate before writing so we never persist a broken preset.
    const clean = parsePreset(JSON.parse(JSON.stringify(preset)));
    const file = this.fileFor(id);
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(clean, null, 2));
    try {
      await rename(tmp, file);
    } catch (err) {
      await unlink(tmp).catch(() => {});
      throw err;
    }
    return presetId(id);
  }

  /** Create an empty preset; refuses to overwrite an existing file. */
  async create(name: string): Promise<{ id: string; preset: Preset }> {
    const id = presetId(name);
    await this.ensureFree(id);
    const preset = emptyPreset(name.trim() || id);
    await this.save(preset, id);
    return { id, preset };
  }

  /** Save a copy of `preset` as a new file named after `to`; refuses to overwrite. */
  async saveCopy(preset: Preset, to: string): Promise<string> {
    const id = presetId(to);
    await this.ensureFree(id);
    return this.save({ ...structuredClone(preset), name: to.trim() || id }, id);
  }

  async duplicate(from: string, to: string): Promise<string> {
    return this.saveCopy(await this.load(from), to);
  }

  async remove(id: string): Promise<void> {
    await unlink(this.fileFor(id));
  }

  private async ensureFree(id: string): Promise<void> {
    if (await this.exists(id)) throw new Error(`a preset file "${presetId(id)}.json" already exists`);
  }

  /** Emits `"changed"` (debounced) whenever a file in the dir is added/edited/removed. */
  watch(): void {
    if (this.watcher) return;
    let timer: NodeJS.Timeout | undefined;
    const ping = (path: string) => {
      if (!path.endsWith(".json")) return; // ignore our own temp files
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
