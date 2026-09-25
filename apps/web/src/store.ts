import { create } from "zustand";
import type {
  ActivitySnapshot,
  Command,
  GatewayState,
  LearnObservation,
  MonitorEvent,
  MonitorFilter,
} from "@midi-gateway/engine";
import { gateway } from "./lib/ws.js";

const MONITOR_CAP = 1200;

interface AppStore {
  connected: boolean;
  latencyMs: number | null;
  gs: GatewayState | null;
  activity: ActivitySnapshot | null;
  monitor: MonitorEvent[];
  monitorPaused: boolean;
  learn: LearnObservation[];
  lastError: string | null;

  /** Never rejects: failures land in `lastError` and resolve to false. */
  send(cmd: Command): Promise<boolean>;
  clearError(): void;
  setMonitorPaused(v: boolean): void;
  clearMonitor(): void;
  setSubscription(channels: ("monitor" | "activity" | "learn")[], f?: MonitorFilter): void;
}

export const useStore = create<AppStore>((set, get) => ({
  connected: false,
  latencyMs: null,
  gs: null,
  activity: null,
  monitor: [],
  monitorPaused: false,
  learn: [],
  lastError: null,

  async send(cmd) {
    try {
      await gateway.send(cmd);
      set({ lastError: null });
      return true;
    } catch (e) {
      set({ lastError: (e as Error).message });
      return false;
    }
  },
  clearError: () => set({ lastError: null }),
  setMonitorPaused: (v) => set({ monitorPaused: v }),
  clearMonitor: () => set({ monitor: [] }),
  setSubscription: (channels, f) => gateway.setSubscription(channels, f),
}));

gateway.on.status = ({ connected, latencyMs }) => useStore.setState({ connected, latencyMs });
gateway.on.state = (gs) => useStore.setState({ gs });
gateway.on.activity = (activity) => useStore.setState({ activity });
gateway.on.learn = (learn) => useStore.setState({ learn });
gateway.on.monitor = (events) => {
  if (useStore.getState().monitorPaused) return;
  const cur = useStore.getState().monitor;
  const next = cur.length + events.length > MONITOR_CAP ? [...cur, ...events].slice(-MONITOR_CAP) : [...cur, ...events];
  useStore.setState({ monitor: next });
};

gateway.connect();

// Convenience selectors -----------------------------------------------------
export const usePreset = () => useStore((s) => s.gs?.preset ?? null);
export const usePorts = () => useStore((s) => s.gs?.ports ?? []);
export const useRoutes = () => useStore((s) => s.gs?.preset.routes ?? []);
