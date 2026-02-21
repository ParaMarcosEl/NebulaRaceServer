# NebulaRaceServer 🚀

Authoritative real-time multiplayer race server for **Nebula Grand Prix**, built with **Node.js**, **Express**, **WebSocket (`ws`)**, and a per-room **worker-thread physics simulation**.

## Overview

NebulaRaceServer hosts race rooms and keeps simulation server-authoritative:

- Accepts WebSocket clients.
- Assigns players to lobby rooms (up to 8 players each).
- Manages race lifecycle phases (lobby → pregame → countdown → racing → finished).
- Runs room physics in `workers/PhysicsWorker.js` and streams state updates back to room clients.

## Tech Stack

- Node.js `>=18`
- Express (health/root endpoint)
- ws (WebSocket server)
- worker_threads (isolated per-room simulation)
- uuid (room/player IDs)

## Repository Layout

- `server.js` — main HTTP/WebSocket process, room orchestration, race lifecycle, worker management.
- `workers/PhysicsWorker.js` — fixed-step simulation loop and collision/movement integration.
- `math.js` — local `Vector3`/`Quaternion` math primitives.
- `fbm.js` — procedural terrain noise helpers.
- `utils.js` — throttling and curve helper utilities.
- `eslint.config.js` — lint config.

## Installation

```bash
npm install
```

## Running

Development (auto-reload):

```bash
npm run dev
```

Production:

```bash
npm start
```

Or directly:

```bash
PORT=3030 ALLOW_FORCE_START=true node server.js
```

## Environment Variables

| Variable | Default | Description |
|---|---:|---|
| `PORT` | `3030` | HTTP/WebSocket bind port |
| `ALLOW_FORCE_START` | `false` | Enables `startNow` client message override |

## Runtime Model

### Main Process (`server.js`)

Responsibilities:

- Tracks all active rooms in memory.
- Routes incoming messages (`join`, `setReady`, `input`, `config`, `finish`, `removed`).
- Broadcasts room-scoped events.
- Spawns one worker per room and forwards player input/config.

### Worker Process (`workers/PhysicsWorker.js`)

Responsibilities:

- Maintains per-player authoritative state.
- Runs fixed-step updates at ~60 Hz.
- Integrates movement and angular motion.
- Applies OBB-vs-terrain signed distance collision response.
- Emits aggregate state snapshots (`stateUpdate`) to main process.

## Room Lifecycle

1. First player joins → server finds lobby room or creates a new room.
2. New room starts a physics worker.
3. Players set ready state.
4. Optional pregame countdown.
5. Race countdown.
6. Race starts (`race:start`).
7. Players report finish (`finish`), server ends race when all present players finished.
8. Room cleanup terminates worker and clears timers.

## WebSocket Protocol

### Client → Server

| Type | Payload (summary) |
|---|---|
| `join` | `{ name, fbmParams, curvePoints }` |
| `setReady` | `{ ready }` |
| `input` | `{ throttle, inputAxis: { x, y } }` |
| `config` | physics tuning fields (`playerSpeed`, `acceleration`, etc.) |
| `finish` | none/optional |
| `removed` | none/optional |
| `startNow` | none (works only when `ALLOW_FORCE_START=true`) |

### Server → Client

| Type | Payload (summary) |
|---|---|
| `connected` | `{ playerId }` |
| `joined` | `{ playerId, roomId, fbmParams, curvePoints }` |
| `room:update` | `{ phase, players[] }` |
| `physics:update` | `{ state }` |
| `pregame:tick` | `{ seconds }` |
| `racecountdown:tick` | `{ seconds }` |
| `race:start` | `{ startedAt }` |
| `race:end` | `{}` |
| `player:finished` | `{ id, finishedAt }` |
| `server:log` | `{ message }` |

## Game Phases

```text
lobby -> pregame -> racecountdown -> racing -> finished
```

## Operational Notes

- Room/player state is currently in-memory (no persistence).
- Server rebroadcasts client `input` messages to peers.
- Physics snapshots are sent continuously from worker to room clients.
- Cleanup currently removes room state and terminates the worker when invoked.

## Suggested Improvement Areas

1. Add message schema validation and stricter payload guards (especially for `input`/`config`).
2. Add heartbeat/ping timeout logic to detect half-open WebSockets.
3. Add proper race-start automation when all lobby players are ready (currently commented out).
4. Harden worker readiness flow so players are never posted before worker init completion.
5. Add structured logging with levels and room/player correlation IDs.
6. Add test coverage (unit tests for workers/PhysicsWorker.js code).
7. Add metrics/observability (tick duration, room count, worker lifecycle events).
8. Add memory/backpressure protections for high-frequency broadcasts.

## Development Quality Checklist

- Keep worker loop allocation-light.
- Avoid blocking code in WebSocket handlers.
- Ensure all room timers/workers are terminated on room teardown.
- Keep protocol backward-compatible when adding message types.

## License

MIT
