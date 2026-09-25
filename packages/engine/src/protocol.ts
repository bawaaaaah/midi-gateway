/**
 * The WebSocket wire protocol shared by the server and the web UI.
 *
 * One connection carries three server-push channels - `state` (config + port
 * status, snapshot then patches), `monitor` (throttled event stream) and
 * `activity` (aggregated held-notes / CC values for the live widgets) - plus
 * request/response `command`s from the client.
 */
import { z } from "zod";
import type { MidiEvent, Port, Preset } from "./types.js";
import type { LearnObservation } from "./learn.js";
import { routeSchema, transformConfigSchema, rtpSessionConfigSchema } from "./presetSchema.js";

// ---------------------------------------------------------------------------
// State snapshot
// ---------------------------------------------------------------------------

export type PortDirection = "in" | "out" | "bidir";

export interface RuntimePort extends Port {
  direction: PortDirection;
  /** The OS currently exposes this port (hw) or the session exists (virtual/rtp). */
  available: boolean;
  /** We hold it open / the rtp session has a peer. */
  connected: boolean;
}

export interface PresetSummary {
  /** Identifier used by every preset command: the file name without `.json`. */
  name: string;
  /** The `name` stored inside the preset (what the user sees; may differ from the file name). */
  title: string;
  file: string;
  updatedAt: number;
  routeCount: number;
}

export interface DiscoveredRtpSession {
  name: string;
  address: string;
  port: number;
}

export interface GatewayState {
  serverVersion: string;
  presetsDir: string;
  /** File name (without `.json`) the active preset is saved to; null if it has no file yet. */
  activePresetName: string | null;
  /** Unsaved changes since the last load/save. */
  dirty: boolean;
  preset: Preset;
  ports: RuntimePort[];
  learn: { active: boolean; routeId: string | null };
  presetList: PresetSummary[];
  /** OS MIDI ports not referenced by the preset yet (for the "add port" picker). */
  availableInputs: string[];
  availableOutputs: string[];
  discoveredRtp: DiscoveredRtpSession[];
  rtpAvailable: boolean;
  midiBackend: "rtmidi" | "null";
}

// ---------------------------------------------------------------------------
// Monitor + activity
// ---------------------------------------------------------------------------

export interface MonitorEvent {
  seq: number;
  t: number;
  stage: "in" | "out";
  routeId?: string;
  routeName?: string;
  portId: string;
  portName: string;
  event: MidiEvent;
}

export interface MonitorFilter {
  portIds?: string[];
  channels?: number[];
  kinds?: MidiEvent["kind"][];
}

export interface HeldNote {
  channel: number;
  note: number;
  velocity: number;
  since: number;
}

export interface ActivityScope {
  heldNotes: HeldNote[];
  /** channel -> controller -> value */
  cc: Record<number, Record<number, number>>;
}

export interface ActivitySnapshot {
  t: number;
  /** portId -> rolling traffic level 0..1 and msg/s in/out. */
  ports: Record<string, { level: number; inRate: number; outRate: number }>;
  /**
   * scopeKey -> aggregate. scopeKey is `port:<portId>` for a port's input or
   * `route:<routeId>:out` for what a route emits.
   */
  scopes: Record<string, ActivityScope>;
}

// ---------------------------------------------------------------------------
// Commands (client -> server)
// ---------------------------------------------------------------------------

const id = z.string().min(1);

export const commandSchema = z.discriminatedUnion("kind", [
  // ports
  z.object({ kind: z.literal("renamePort"), portId: id, name: z.string().min(1) }),
  z.object({ kind: z.literal("createVirtualPort"), direction: z.enum(["in", "out"]), name: z.string().min(1) }),
  z.object({
    kind: z.literal("addHardwarePort"),
    direction: z.enum(["in", "out"]),
    systemName: z.string().min(1),
    name: z.string().optional(),
  }),
  z.object({ kind: z.literal("deletePort"), portId: id }),
  z.object({ kind: z.literal("createRtpSession"), name: z.string().min(1), config: rtpSessionConfigSchema }),
  z.object({ kind: z.literal("rtpConnect"), portId: id, host: z.string().min(1), port: z.number().int().min(1).max(65535) }),
  z.object({ kind: z.literal("rtpDisconnect"), portId: id }),

  // routes
  z.object({ kind: z.literal("addRoute"), name: z.string().optional() }),
  z.object({ kind: z.literal("updateRoute"), route: routeSchema }),
  z.object({ kind: z.literal("deleteRoute"), routeId: id }),
  z.object({ kind: z.literal("reorderRoutes"), ids: z.array(id) }),
  z.object({ kind: z.literal("setRouteEnabled"), routeId: id, enabled: z.boolean() }),

  // transforms
  z.object({ kind: z.literal("addTransform"), routeId: id, config: transformConfigSchema }),
  z.object({ kind: z.literal("updateTransform"), routeId: id, config: transformConfigSchema }),
  z.object({ kind: z.literal("deleteTransform"), routeId: id, transformId: id }),
  z.object({ kind: z.literal("reorderTransforms"), routeId: id, ids: z.array(id) }),

  // names
  z.object({ kind: z.literal("setNoteName"), note: z.number().int().min(0).max(127), name: z.string() }),
  z.object({ kind: z.literal("bulkSetNoteNames"), names: z.record(z.string(), z.string()) }),

  // learn
  z.object({ kind: z.literal("learnStart"), routeId: id.optional() }),
  z.object({ kind: z.literal("learnStop") }),
  z.object({ kind: z.literal("learnClear") }),

  // presets
  z.object({ kind: z.literal("savePreset"), name: z.string().optional() }),
  z.object({ kind: z.literal("loadPreset"), name: z.string().min(1) }),
  z.object({ kind: z.literal("newPreset"), name: z.string().min(1) }),
  /** Copy preset file `from` to a new file `to`; without `from`, copy the current (possibly unsaved) preset. */
  z.object({ kind: z.literal("duplicatePreset"), from: z.string().min(1).optional(), to: z.string().min(1) }),
  z.object({ kind: z.literal("deletePreset"), name: z.string().min(1) }),
  z.object({ kind: z.literal("revealPresets") }),

  // misc
  z.object({ kind: z.literal("panic"), routeId: id.optional() }),
  z.object({ kind: z.literal("renamePreset"), name: z.string().min(1) }),
]);

export type Command = z.infer<typeof commandSchema>;

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("subscribe"),
    channels: z.array(z.enum(["monitor", "activity", "learn"])),
    monitorFilter: z
      .object({
        portIds: z.array(id).optional(),
        channels: z.array(z.number().int()).optional(),
        kinds: z.array(z.string()).optional(),
      })
      .optional(),
  }),
  z.object({ type: z.literal("ping"), t: z.number() }),
  z.object({ type: z.literal("command"), ref: z.string(), command: commandSchema }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ---------------------------------------------------------------------------
// Server -> client messages
// ---------------------------------------------------------------------------

export type ServerMessage =
  | { type: "hello"; serverVersion: string; presetsDir: string }
  | { type: "state"; state: GatewayState }
  | { type: "statePatch"; patch: Partial<GatewayState> }
  | { type: "monitor"; events: MonitorEvent[] }
  | { type: "activity"; activity: ActivitySnapshot }
  | { type: "learn"; observations: LearnObservation[] }
  | { type: "commandResult"; ref: string; ok: boolean; message?: string }
  | { type: "error"; message: string }
  | { type: "pong"; t: number };
