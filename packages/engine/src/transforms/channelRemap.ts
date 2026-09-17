import type { Transform } from "../context.js";
import type { MidiEvent, TransformConfig } from "../types.js";
import { clampChannel } from "../event.js";

type Cfg = Extract<TransformConfig, { type: "channelRemap" }>;

/** Rewrite the channel of any channel-bearing event according to `map`. */
export function createChannelRemap(cfg: Cfg): Transform {
  const map = new Map<number, number>();
  for (const [from, to] of Object.entries(cfg.map)) {
    if (to !== undefined) map.set(Number(from), clampChannel(to));
  }

  return {
    id: cfg.id,
    type: cfg.type,
    process(ev: MidiEvent): MidiEvent[] {
      if (!("channel" in ev)) return [ev];
      const to = map.get(ev.channel);
      if (to === undefined || to === ev.channel) return [ev];
      return [{ ...ev, channel: to }];
    },
  };
}
