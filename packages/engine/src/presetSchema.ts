/**
 * Runtime validation for presets and transform configs (zod). `types.ts` stays
 * the source of truth for the TypeScript shapes; these schemas guard anything
 * that crosses a trust boundary - files on disk and commands from the browser.
 */
import { z } from "zod";
import { PRESET_SCHEMA_VERSION, type Preset } from "./types.js";

const u7 = z.number().int().min(0).max(127);
const u14 = z.number().int().min(0).max(16383);
const channel = z.number().int().min(0).max(15);
const id = z.string().min(1);

export const velocitySpecSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("passthrough") }),
  z.object({ mode: z.literal("fixed"), value: u7 }),
  z.object({ mode: z.literal("scale"), min: u7, max: u7 }),
  z.object({
    mode: z.literal("curve"),
    shape: z.enum(["linear", "exp", "log", "sCurve"]),
    amount: z.number().min(0).max(1).optional(),
  }),
  z.object({ mode: z.literal("points"), points: z.array(z.tuple([z.number(), z.number()])) }),
]);

export const outputSpecSchema = z.object({
  note: u7.optional(),
  transpose: z.number().int().min(-127).max(127).optional(),
  channel: channel.optional(),
  velocity: velocitySpecSchema.optional(),
  name: z.string().optional(),
  mute: z.boolean().optional(),
});

const zoneSchema = z.object({ id, from: u7, to: u7 });
const noteGroupSchema = z.object({ id, notes: z.array(u7) });

export const partitionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("identity") }),
  z.object({ mode: z.literal("byPitchClass") }),
  z.object({
    mode: z.literal("rangeGenerator"),
    start: u7,
    size: z.number().int().min(1).max(127),
    count: z.number().int().min(1).max(128),
  }),
  z.object({ mode: z.literal("manualZones"), zones: z.array(zoneSchema) }),
  z.object({ mode: z.literal("explicitList"), groups: z.array(noteGroupSchema) }),
]);

export const layerConditionSchema = z.union([
  z.literal("default"),
  z.object({ cc: u7, min: u7.optional(), max: u7.optional(), channel: channel.optional() }),
]);

export const layerSchema = z.object({
  id,
  when: layerConditionSchema,
  buckets: z.record(z.string(), outputSpecSchema),
});

const common = { id, enabled: z.boolean(), label: z.string().optional() };

const filterMatchSchema = z.object({
  kinds: z
    .array(z.enum(["noteOn", "noteOff", "cc", "pitchBend", "aftertouch", "program", "raw"]))
    .optional(),
  channels: z.array(channel).optional(),
  noteMin: u7.optional(),
  noteMax: u7.optional(),
  velocityMin: u7.optional(),
  velocityMax: u7.optional(),
  controllers: z.array(u7).optional(),
});

const ccRemapRuleSchema = z.object({
  id,
  fromController: u7,
  fromChannel: channel.optional(),
  to: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("cc"),
      controller: u7,
      channel: channel.optional(),
      invert: z.boolean().optional(),
      scale: z.tuple([u7, u7]).optional(),
    }),
    z.object({ kind: z.literal("note"), note: u7, channel: channel.optional(), threshold: u7.optional() }),
    z.object({ kind: z.literal("drop") }),
  ]),
});

const comboTriggerSchema = z.object({
  id,
  kind: z.enum(["note", "ccAbove", "ccBelow"]),
  value: u7,
  threshold: u7.optional(),
  channel: channel.optional(),
});

export const transformConfigSchema = z.discriminatedUnion("type", [
  z.object({ ...common, type: z.literal("channelRemap"), map: z.record(z.string(), channel) }),
  z.object({ ...common, type: z.literal("transpose"), semitones: z.number().int(), wrap: z.boolean().optional() }),
  z.object({
    ...common,
    type: z.literal("velocity"),
    spec: velocitySpecSchema,
    channels: z.array(channel).optional(),
  }),
  z.object({ ...common, type: z.literal("filter"), action: z.enum(["drop", "keep"]), match: filterMatchSchema }),
  z.object({ ...common, type: z.literal("ccRemap"), rules: z.array(ccRemapRuleSchema) }),
  z.object({
    ...common,
    type: z.literal("keyboardMapper"),
    channels: z.array(channel).optional(),
    partition: partitionSchema,
    layers: z.array(layerSchema),
  }),
  z.object({
    ...common,
    type: z.literal("combo"),
    windowMs: z.number().int().min(1).max(2000),
    triggers: z.array(comboTriggerSchema).min(1),
    output: outputSpecSchema.extend({ channel: channel.optional() }),
    suppressTriggers: z.boolean(),
  }),
  z.object({ ...common, type: z.literal("learnTap") }),
]);

export const rtpSessionConfigSchema = z.object({
  sessionName: z.string().min(1),
  // The data channel uses localPort + 1.
  localPort: z.number().int().min(1).max(65534),
  mode: z.enum(["listener", "initiator"]),
  remoteHost: z.string().optional(),
  remotePort: z.number().int().min(1).max(65535).optional(),
});

export const portSchema = z.object({
  id,
  name: z.string(),
  kind: z.enum(["hw-in", "hw-out", "virtual-in", "virtual-out", "rtp"]),
  systemName: z.string().optional(),
  rtp: rtpSessionConfigSchema.optional(),
});

export const routeSchema = z.object({
  id,
  name: z.string(),
  enabled: z.boolean(),
  sources: z.array(id),
  destinations: z.array(id),
  transforms: z.array(transformConfigSchema),
});

export const presetSchema = z.object({
  schemaVersion: z.literal(PRESET_SCHEMA_VERSION),
  name: z.string(),
  ports: z.array(portSchema),
  routes: z.array(routeSchema),
  noteNames: z.record(z.string(), z.string()),
  description: z.string().optional(),
});

export type PresetInput = z.input<typeof presetSchema>;

/** Parse + migrate arbitrary JSON into a valid {@link Preset}, or throw. */
export function parsePreset(data: unknown): Preset {
  const migrated = migrate(data);
  return presetSchema.parse(migrated) as Preset;
}

/** Bring older preset shapes up to the current schema version. */
function migrate(data: unknown): unknown {
  if (typeof data !== "object" || data === null) return data;
  const obj = { ...(data as Record<string, unknown>) }; // never mutate the caller's object
  if (obj.schemaVersion === undefined) obj.schemaVersion = PRESET_SCHEMA_VERSION;
  // Future: if (obj.schemaVersion === 1) { ...; obj.schemaVersion = 2; }
  return obj;
}
