/**
 * Holds the active preset and applies the structural commands that mutate it
 * (ports, routes, transforms, names). Preset file I/O, learn and panic are
 * handled by the caller - {@link applyStructural} returns `handled: false` for
 * those so the WebSocket layer can route them to the right service.
 */
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { emptyPreset, type Command, type Preset, type Route } from "@midi-gateway/engine";

const uid = (p: string) => `${p}_${randomUUID().slice(0, 8)}`;

export interface ApplyResult {
  handled: boolean;
  ok: boolean;
  message?: string;
}

export class GatewayStore extends EventEmitter {
  preset: Preset = emptyPreset();
  activePresetName: string | null = null;
  dirty = false;

  loadPreset(preset: Preset, name: string | null, dirty = false): void {
    this.preset = preset;
    this.activePresetName = name;
    this.dirty = dirty;
    this.emit("preset");
  }

  private touched(): void {
    this.dirty = true;
    this.emit("preset");
  }

  private route(id: string): Route | undefined {
    return this.preset.routes.find((r) => r.id === id);
  }

  applyStructural(cmd: Command): ApplyResult {
    const ok = (message?: string): ApplyResult => ({ handled: true, ok: true, message });
    const fail = (message: string): ApplyResult => ({ handled: true, ok: false, message });

    switch (cmd.kind) {
      // ---- ports ----
      case "renamePort": {
        const p = this.preset.ports.find((x) => x.id === cmd.portId);
        if (!p) return fail("unknown port");
        p.name = cmd.name;
        this.touched();
        return ok();
      }
      case "createVirtualPort": {
        this.preset.ports.push({
          id: uid("port"),
          name: cmd.name,
          kind: cmd.direction === "in" ? "virtual-in" : "virtual-out",
        });
        this.touched();
        return ok();
      }
      case "addHardwarePort": {
        this.preset.ports.push({
          id: uid("port"),
          name: cmd.name ?? cmd.systemName,
          kind: cmd.direction === "in" ? "hw-in" : "hw-out",
          systemName: cmd.systemName,
        });
        this.touched();
        return ok();
      }
      case "deletePort": {
        const before = this.preset.ports.length;
        this.preset.ports = this.preset.ports.filter((p) => p.id !== cmd.portId);
        if (this.preset.ports.length === before) return fail("unknown port");
        for (const r of this.preset.routes) {
          r.sources = r.sources.filter((s) => s !== cmd.portId);
          r.destinations = r.destinations.filter((d) => d !== cmd.portId);
        }
        this.touched();
        return ok();
      }
      case "createRtpSession": {
        // Each session binds localPort (control) and localPort + 1 (data).
        const clash = this.preset.ports.find(
          (p) => p.rtp && Math.abs(p.rtp.localPort - cmd.config.localPort) < 2,
        );
        if (clash) return fail(`UDP ports ${cmd.config.localPort}-${cmd.config.localPort + 1} overlap "${clash.name}"`);
        this.preset.ports.push({ id: uid("rtp"), name: cmd.name, kind: "rtp", rtp: cmd.config });
        this.touched();
        return ok();
      }
      case "rtpConnect": {
        const p = this.preset.ports.find((x) => x.id === cmd.portId);
        if (!p?.rtp) return fail("not an rtp port");
        p.rtp = { ...p.rtp, mode: "initiator", remoteHost: cmd.host, remotePort: cmd.port };
        this.touched();
        return ok();
      }
      case "rtpDisconnect": {
        const p = this.preset.ports.find((x) => x.id === cmd.portId);
        if (!p?.rtp) return fail("not an rtp port");
        p.rtp = { ...p.rtp, mode: "listener", remoteHost: undefined, remotePort: undefined };
        this.touched();
        return ok();
      }

      // ---- routes ----
      case "addRoute": {
        this.preset.routes.push({
          id: uid("route"),
          name: cmd.name ?? `Route ${this.preset.routes.length + 1}`,
          enabled: true,
          sources: [],
          destinations: [],
          transforms: [],
        });
        this.touched();
        return ok();
      }
      case "updateRoute": {
        const i = this.preset.routes.findIndex((r) => r.id === cmd.route.id);
        if (i < 0) return fail("unknown route");
        this.preset.routes[i] = cmd.route;
        this.touched();
        return ok();
      }
      case "deleteRoute": {
        const before = this.preset.routes.length;
        this.preset.routes = this.preset.routes.filter((r) => r.id !== cmd.routeId);
        if (this.preset.routes.length === before) return fail("unknown route");
        this.touched();
        return ok();
      }
      case "reorderRoutes": {
        this.preset.routes = orderBy(this.preset.routes, cmd.ids, (r) => r.id);
        this.touched();
        return ok();
      }
      case "setRouteEnabled": {
        const r = this.route(cmd.routeId);
        if (!r) return fail("unknown route");
        r.enabled = cmd.enabled;
        this.touched();
        return ok();
      }

      // ---- transforms ----
      case "addTransform": {
        const r = this.route(cmd.routeId);
        if (!r) return fail("unknown route");
        r.transforms.push(cmd.config);
        this.touched();
        return ok();
      }
      case "updateTransform": {
        const r = this.route(cmd.routeId);
        if (!r) return fail("unknown route");
        const i = r.transforms.findIndex((t) => t.id === cmd.config.id);
        if (i < 0) return fail("unknown transform");
        r.transforms[i] = cmd.config;
        this.touched();
        return ok();
      }
      case "deleteTransform": {
        const r = this.route(cmd.routeId);
        if (!r) return fail("unknown route");
        r.transforms = r.transforms.filter((t) => t.id !== cmd.transformId);
        this.touched();
        return ok();
      }
      case "reorderTransforms": {
        const r = this.route(cmd.routeId);
        if (!r) return fail("unknown route");
        r.transforms = orderBy(r.transforms, cmd.ids, (t) => t.id);
        this.touched();
        return ok();
      }

      // ---- names ----
      case "setNoteName": {
        if (cmd.name.trim()) this.preset.noteNames[cmd.note] = cmd.name;
        else delete this.preset.noteNames[cmd.note];
        this.touched();
        return ok();
      }
      case "bulkSetNoteNames": {
        for (const [key, name] of Object.entries(cmd.names)) {
          const note = Number(key);
          if (!Number.isInteger(note) || note < 0 || note > 127) continue;
          if (name.trim()) this.preset.noteNames[note] = name;
          else delete this.preset.noteNames[note];
        }
        this.touched();
        return ok();
      }
      case "renamePreset": {
        this.preset.name = cmd.name;
        this.touched();
        return ok();
      }

      default:
        return { handled: false, ok: false };
    }
  }
}

function orderBy<T>(items: T[], order: string[], key: (t: T) => string): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...items].sort((a, b) => (rank.get(key(a)) ?? 1e9) - (rank.get(key(b)) ?? 1e9));
}
