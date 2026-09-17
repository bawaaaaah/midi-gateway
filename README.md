# MIDI Gateway

An intelligent MIDI patchbay with a web UI. It takes **several MIDI streams in**,
runs them through an **editable chain of transforms**, and sends them **back out**
to other ports — local hardware, CoreMIDI/ALSA virtual ports, or the network
(RTP‑MIDI / AppleMIDI).

Built for two jobs:

- **Drums** — an *auto‑learn* mode captures every hit, shows it in a table, and lets
  you re‑assign the outputs **in bulk**. The **hi‑hat (charleston)** case is handled:
  the same pad can sound *open / half / closed* depending on the hi‑hat pedal CC,
  sampled at strike time with **zero added latency**.
- **Piano** — keyboard remapping modes:
  - **Group by note** — every C (C0, C1, C3 …) becomes one chosen note.
  - **Split every N keys** — each zone of the keyboard collapses to a single note.
  - **Expression‑pedal layers** — a note plays differently while a CC (expression
    pedal, sustain…) is pressed. **Combines** with both modes above.

Presets are plain **`.json` files in a folder** (`~/midi-gateway/presets/` by
default). No database.

---

## Quick start

```bash
npm install
npm run dev
```

- Dev opens the web UI on **http://localhost:4665** (Vite) proxying the gateway on
  **:4666**.
- `npm run build && npm start` runs the gateway alone on **:4666**, serving the
  built UI.
- Tests: `npm test` (engine unit tests, `vitest`).

On first run the server creates `~/midi-gateway/` with `config.json` and a
`presets/` folder, and opens a `Default` preset.

> **macOS**: virtual ports use CoreMIDI and appear in *Audio MIDI Setup* and in
> Ableton / REAPER immediately. If the native `@julusian/midi` module can't load,
> the gateway still runs (UI + preset editing) but without real MIDI I/O.

---

## Concepts

```
Port ──┐                        ┌── Port
Port ──┼─▶ Route: [transform…] ─┼──▶ Port
Port ──┘   (ordered chain)      └── Port
```

- **Port** — a hardware in/out, a virtual in/out, or a bidirectional RTP session.
  Rename freely; the name is stored in the preset.
- **Route** — one or more source ports → an ordered list of transforms → one or
  more destination ports.
- **Transform** — a pure function `event → event[]`. Chainable, reorderable,
  individually enable/disable.

### Transforms

| Transform | What it does |
|---|---|
| **Keyboard mapper** | the piano modes + hi‑hat (see below) |
| **Combo** | fire one note when several notes/CCs happen within a time window |
| Transpose | shift notes by N semitones |
| Velocity | reshape note‑on velocity (fixed / scale / curve) |
| Channel remap | move events between channels |
| CC remap | CC → CC, CC → note, or drop |
| Filter | drop or keep events by type / note range / channel |
| Learn tap | feed the Learn table from this point in the chain |

### Keyboard mapper

Each incoming note is resolved in three steps:

1. **Partition** puts the note in a *bucket* — a pitch class, a keyboard zone, an
   explicit group, or the single bucket `all`.
2. **Layers** are scanned. The first non‑default layer whose CC condition holds
   *and* that defines the bucket wins; otherwise the `default` layer is used;
   otherwise the note passes through untouched. The CC is read **at note‑on time**,
   so there is no latency.
3. The winning **output spec** produces an output note (absolute or transposed),
   channel and velocity.

Folded notes are reference‑counted and note‑offs replay the *exact* output the
note‑on produced, so changing a pedal mid‑note never leaves a stuck note.

| You want | Set up |
|---|---|
| Every C → one note | partition **Group by note**, map bucket `C` |
| Every 12 keys → one note | partition **Split every N** (size 12), map each zone |
| `C0` vs `C0` + expression pedal | partition **Whole keyboard**, add a **pedal / CC layer** (`CC 11`, min 64) |
| Group **+** pedal | **Group by note** with a pedal layer |
| Split **+** pedal | **Split every N** with a pedal layer |
| Hi‑hat open/half/closed by pedal | **Explicit groups** = the hi‑hat notes, layers `CC4 ≤ 40`, `41–80`, default |

### Auto‑learn workflow

1. **Learn → Start**, play your controller. Every event is captured, de‑duplicated
   by signature, and shown live with count, velocity range, and — for note hits —
   which CCs were active during the strike (the *hi‑hat pedal* hint).
2. Rename notes inline, or **Name as GM drums**.
3. Select rows → **→ Keyboard mapper**, **→ Hi‑hat by pedal**, or **→ Combo** to
   drop a pre‑filled transform onto a route. Fine‑tune it in the Routes tab.

### Live UI

The WebSocket carries three server‑push channels: `state` (snapshot + patches),
`monitor` (throttled, CC‑decimated event stream), and `activity` (aggregated
held‑notes / CC values at ~30 fps). The piano keyboards, pad grids, CC meters and
activity LEDs are all driven by `activity`; the Monitor tab's event log is the
`monitor` stream.

### Network MIDI (RTP‑MIDI)

Ports of kind `rtp` are bidirectional AppleMIDI sessions
(`@somesmall.studio/rtpmidi`). Create a **listener** and connect to it from macOS
*Audio MIDI Setup → Network*, or an **initiator** pointed at a remote host. mDNS
discovery is best‑effort; manual `host:port` always works.

---

## Project layout

```
packages/engine   pure TS transform engine — no I/O. Types, event parse/serialize,
                  all transforms, RouteChain, zod preset/protocol schemas, learn
                  helpers. Unit‑tested with vitest.
packages/server   MIDI I/O (@julusian/midi + rtpmidi), PortRegistry, Router,
                  Telemetry, preset JSON store, Fastify HTTP + WebSocket.
apps/web          React + Vite + Tailwind UI. Zustand store fed by the WebSocket.
```

## Scripts

| | |
|---|---|
| `npm run dev` | engine watch + server (tsx) + web (vite), all together |
| `npm run build` | build engine → web → server |
| `npm start` | run the built server (serves the built UI on `:4666`) |
| `npm test` | engine unit tests |
| `npm run typecheck` | `tsc -b` across all packages |

## Configuration

`~/midi-gateway/config.json`:

```jsonc
{
  "presetsDir": "/Users/you/midi-gateway/presets",
  "activePreset": "Default",
  "httpPort": 4666,
  "host": "127.0.0.1",       // "0.0.0.0" to reach the UI from the LAN
  "rtp": { "basePort": 5004, "bonjour": true }
}
```

Example presets are in [`examples/`](examples/) — copy them into your `presetsDir`
to try them.
