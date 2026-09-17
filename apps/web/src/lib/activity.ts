import { useMemo } from "react";
import type { ActivityScope, ActivitySnapshot } from "@midi-gateway/engine";
import { useStore } from "../store.js";

const EMPTY: ActivityScope = { heldNotes: [], cc: {} };

/** The whole activity snapshot. Changes ~30x/s; unaffected by the monitor stream. */
export function useActivity(): ActivitySnapshot | null {
  return useStore((s) => s.activity);
}

export function usePortActivity(portId?: string): ActivityScope {
  const a = useActivity();
  return (portId ? a?.scopes[`port:${portId}`] : undefined) ?? EMPTY;
}

export function useRouteOutActivity(routeId?: string): ActivityScope {
  const a = useActivity();
  return (routeId ? a?.scopes[`route:${routeId}:out`] : undefined) ?? EMPTY;
}

export function usePortLevel(portId?: string): number {
  const a = useActivity();
  return (portId ? a?.ports[portId]?.level : undefined) ?? 0;
}

/** Merge held notes / CC across several input ports (a route can have many sources). */
export function useMergedInputActivity(portIds: string[]): ActivityScope {
  const a = useActivity();
  const key = portIds.join(",");
  return useMemo(() => {
    if (!a) return EMPTY;
    const held: ActivityScope["heldNotes"] = [];
    const cc: ActivityScope["cc"] = {};
    for (const id of key ? key.split(",") : []) {
      const sc = a.scopes[`port:${id}`];
      if (!sc) continue;
      held.push(...sc.heldNotes);
      for (const [ch, ctrls] of Object.entries(sc.cc)) cc[+ch] = { ...(cc[+ch] ?? {}), ...ctrls };
    }
    return held.length || Object.keys(cc).length ? { heldNotes: held, cc } : EMPTY;
  }, [a, key]);
}
