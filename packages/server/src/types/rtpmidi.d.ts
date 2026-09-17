/**
 * Minimal ambient types for `@somesmall.studio/rtpmidi` (a maintained fork of
 * `rtpmidi`). Only the surface the gateway uses is declared.
 */
declare module "@somesmall.studio/rtpmidi" {
  import type { EventEmitter } from "node:events";

  export interface SessionOptions {
    localName?: string;
    bonjourName?: string;
    port?: number;
    published?: boolean;
  }

  export interface RemoteSessionInfo {
    name: string;
    address: string;
    port: number;
  }

  export class Session extends EventEmitter {
    name: string;
    port: number;
    bonjourName: string;
    /** deltaTime in seconds; message is a byte array. */
    sendMessage(deltaTime: number, message: number[] | Uint8Array): void;
    connect(opts: { address: string; port: number }): void;
    end(): void;
    getStreams(): unknown[];
    on(event: "message", cb: (deltaTime: number, message: number[]) => void): this;
    on(event: "streamAdded" | "streamRemoved", cb: (e: unknown) => void): this;
    on(event: string, cb: (...args: unknown[]) => void): this;
  }

  export interface Manager extends EventEmitter {
    createSession(opts: SessionOptions): Session;
    removeSession(session: Session): void;
    getSessions(): Session[];
    startDiscovery(): void;
    stopDiscovery(): void;
    changeSession(session: Session): void;
    on(
      event: "remoteSessionAdded" | "remoteSessionRemoved",
      cb: (e: { remoteSession: RemoteSessionInfo }) => void,
    ): this;
    on(event: string, cb: (...args: unknown[]) => void): this;
  }

  export const manager: Manager;
  const _default: { manager: Manager; Session: typeof Session };
  export default _default;
}
