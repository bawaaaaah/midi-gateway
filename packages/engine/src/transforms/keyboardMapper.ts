/**
 * The heart of the piano modes and the hi-hat (charleston) case.
 *
 * A note is resolved in three steps:
 *   1. `partition` puts the incoming note in a *bucket*
 *      (a pitch class, a keyboard zone, an explicit group, or the single
 *      bucket "all").
 *   2. `layers` are scanned: the first non-default layer whose CC condition
 *      holds *and* that defines the bucket wins; otherwise the "default"
 *      layer's bucket is used; otherwise the note passes through untouched.
 *   3. the winning {@link OutputSpec} is turned into an output note
 *      (absolute or transposed), channel and velocity.
 *
 * The CC condition is sampled at note-on time, so there is no added latency.
 * A {@link NoteTracker} guarantees the matching note-off targets the exact
 * output the note-on produced and that folded notes stop only on the last
 * release.
 */
import type { RouteContext, Transform } from "../context.js";
import type {
  Layer,
  LayerCondition,
  MidiEvent,
  OutputSpec,
  Partition,
  TransformConfig,
} from "../types.js";
import { clamp7, clampChannel, pitchClass } from "../event.js";
import { applyVelocity } from "../velocity.js";
import { NoteTracker, type ResolvedOutput } from "../noteTracker.js";

type Cfg = Extract<TransformConfig, { type: "keyboardMapper" }>;

const MUTED: ResolvedOutput = { channel: -1, note: -1 };
const isMuted = (o: ResolvedOutput) => o.note < 0;

export function bucketOf(partition: Partition, note: number): string {
  switch (partition.mode) {
    case "identity":
      return "all";
    case "byPitchClass":
      return `pc${pitchClass(note)}`;
    case "rangeGenerator": {
      const span = partition.size * partition.count;
      const i = Math.floor((note - partition.start) / partition.size);
      if (note < partition.start || note >= partition.start + span || i < 0 || i >= partition.count) {
        return "out";
      }
      return `z${i}`;
    }
    case "manualZones": {
      const z = partition.zones.find((zone) => note >= zone.from && note <= zone.to);
      return z ? z.id : "out";
    }
    case "explicitList": {
      const g = partition.groups.find((group) => group.notes.includes(note));
      return g ? g.id : "out";
    }
  }
}

function conditionHolds(when: LayerCondition, ctx: RouteContext, noteChannel: number): boolean {
  if (when === "default") return true;
  const ch = when.channel ?? noteChannel;
  const v = ctx.cc.get(ch, when.cc);
  if (when.min !== undefined && v < when.min) return false;
  if (when.max !== undefined && v > when.max) return false;
  return true;
}

function resolveSpec(
  layers: Layer[],
  bucketId: string,
  ctx: RouteContext,
  noteChannel: number,
): OutputSpec | null {
  for (const layer of layers) {
    if (layer.when === "default") continue;
    if (conditionHolds(layer.when, ctx, noteChannel) && layer.buckets[bucketId]) {
      return layer.buckets[bucketId]!;
    }
  }
  const def = layers.find((l) => l.when === "default");
  return def?.buckets[bucketId] ?? null;
}

export function createKeyboardMapper(cfg: Cfg): Transform {
  const tracker = new NoteTracker();
  const channels = cfg.channels && cfg.channels.length ? new Set(cfg.channels) : null;
  const inScope = (ch: number) => !channels || channels.has(ch);

  const noteOnEvent = (src: MidiEvent, out: ResolvedOutput, velocity: number): MidiEvent => ({
    t: src.t,
    sourceId: src.sourceId,
    kind: "noteOn",
    channel: out.channel,
    note: out.note,
    velocity,
  });
  const noteOffEvent = (src: MidiEvent, out: ResolvedOutput, velocity: number): MidiEvent => ({
    t: src.t,
    sourceId: src.sourceId,
    kind: "noteOff",
    channel: out.channel,
    note: out.note,
    velocity,
  });

  return {
    id: cfg.id,
    type: cfg.type,

    process(ev: MidiEvent, ctx: RouteContext): MidiEvent[] {
      if (ev.kind === "noteOn") {
        if (!inScope(ev.channel)) return [ev];

        const bucketId = bucketOf(cfg.partition, ev.note);
        const spec = resolveSpec(cfg.layers, bucketId, ctx, ev.channel);

        let out: ResolvedOutput;
        let velocity = ev.velocity;
        if (!spec) {
          out = { channel: ev.channel, note: ev.note }; // passthrough, still tracked
        } else if (spec.mute) {
          out = MUTED;
        } else {
          const note = spec.note ?? ev.note + (spec.transpose ?? 0);
          if (note < 0 || note > 127) {
            // Out of range -> drop, but keep tracking it so the note-off is swallowed too.
            out = MUTED;
          } else {
            out = { channel: spec.channel ?? ev.channel, note: clamp7(note) };
            velocity = Math.max(1, applyVelocity(spec.velocity, ev.velocity));
          }
        }

        // Retrigger of an already-held source key: release it first.
        const existing = tracker.noteOff(ev.channel, ev.note);
        const pre: MidiEvent[] = [];
        if (existing && existing.emit && !isMuted(existing.out)) {
          pre.push(noteOffEvent(ev, existing.out, 0));
        }

        if (isMuted(out)) {
          tracker.noteOn(ev.channel, ev.note, out);
          return pre;
        }

        const res = tracker.noteOn(ev.channel, ev.note, out);
        const evts = [...pre];
        if (res.releaseFirst) evts.push(noteOffEvent(ev, res.releaseFirst, 0));
        if (res.emit) evts.push(noteOnEvent(ev, out, velocity));
        // Already sounding for another held key: optionally re-play it. The off
        // comes first so receivers that stack voices never end up with two.
        else if (cfg.retrigger) evts.push(noteOffEvent(ev, out, 0), noteOnEvent(ev, out, velocity));
        return evts;
      }

      if (ev.kind === "noteOff") {
        if (!inScope(ev.channel)) return [ev];
        const res = tracker.noteOff(ev.channel, ev.note);
        if (!res) return [ev]; // untracked (transform added mid-note): let it through
        if (isMuted(res.out) || !res.emit) return [];
        return [noteOffEvent(ev, res.out, ev.velocity)];
      }

      if (ev.kind === "aftertouch" && ev.note !== undefined && inScope(ev.channel)) {
        // Follow the output the held note-on actually produced, so a pedal move
        // mid-note doesn't send pressure to a different note.
        const held = tracker.outputFor(ev.channel, ev.note);
        if (held) return isMuted(held) ? [] : [{ ...ev, channel: held.channel, note: held.note }];
        // Not held: best-effort, follow the same partition/layer resolution.
        const spec = resolveSpec(cfg.layers, bucketOf(cfg.partition, ev.note), ctx, ev.channel);
        if (spec && !spec.mute) {
          const note = spec.note ?? ev.note + (spec.transpose ?? 0);
          if (note < 0 || note > 127) return [];
          return [{ ...ev, channel: spec.channel ?? ev.channel, note: clamp7(note) }];
        }
      }

      return [ev];
    },

    flush(ctx: RouteContext): MidiEvent[] {
      const now = ctx.now;
      const offs = tracker
        .activeOutputs()
        .filter((o) => !isMuted(o))
        .map<MidiEvent>((o) => ({
          t: now,
          sourceId: "",
          kind: "noteOff",
          channel: clampChannel(o.channel),
          note: o.note,
          velocity: 0,
        }));
      tracker.clear();
      return offs;
    },
  };
}
