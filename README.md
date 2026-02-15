Here’s a clean, professional `README.md` you can drop into `NebulaRaceServer/`. It’s written to match the architecture you’ve built and keeps it clear for contributors or future employers reviewing the project.

---

# NebulaRaceServer 🚀

Authoritative multiplayer game server for **Nebula Grand Prix**.

NebulaRaceServer is a real-time Node.js + WebSocket server that manages rooms, player state, and deterministic physics simulation using worker threads. It is designed to support multiple concurrent race rooms, each with its own isolated physics engine.

---

## 🧠 Architecture Overview

The server is built around three core layers:

### 1️⃣ HTTP + WebSocket Layer (`server.js`)

* Built with **Express**
* Uses **ws** for WebSocket communication
* Handles:

  * Player connections
  * Room creation & management
  * Race lifecycle (lobby → pregame → countdown → racing → finished)
  * Broadcasting game state to clients

### 2️⃣ Room System

Each room contains:

* Unique `roomId`
* Player registry
* Game phase
* Timers (pregame & race countdown)
* Dedicated physics worker
* Track configuration (FBM params + curve points)

Rooms are created dynamically and capped at:

```js
const MAX_PLAYERS_PER_ROOM = 8;
```

Each room has its own isolated physics simulation via a Worker thread.

---

### 3️⃣ Physics Engine (`workers/PhysicsWorker.js`)

Each room spawns a dedicated Worker thread responsible for:

* Fixed-step simulation (60 Hz)
* Player movement
* Rotation physics
* Thrust & braking model
* OBB terrain collision detection
* Signed distance field planet terrain
* Deterministic state updates

Physics runs independently of the WebSocket event loop.

State updates are emitted back to the main thread:

```js
parentPort.postMessage({ type: 'stateUpdate', state: out });
```

The main server then broadcasts:

```js
broadcast(roomId, 'physics:update', { state });
```

---

## ⚙️ Features

### Multiplayer

* Automatic room creation
* Max 8 players per room
* Room-based broadcast isolation
* Player ready state system
* Race start countdown system
* Finish detection

### Physics

* 60 Hz fixed timestep
* Quaternion-based rotation
* Signed speed-based thrust model
* Forward vector–derived velocity reconstruction
* Exponential velocity smoothing
* Allocation-free inner loop
* OBB vs procedural planet collision
* FBM & Ridged terrain support

### Performance Optimizations

* Worker threads per room
* No allocations inside physics loop
* Vector & Quaternion object reuse
* Log throttling utility
* Minimal IPC payload size

---

## 🛰️ Message Flow

### Client → Server

| Type       | Description               |
| ---------- | ------------------------- |
| `join`     | Join or create a room     |
| `setReady` | Mark player ready         |
| `input`    | Throttle & axis input     |
| `config`   | Update physics parameters |
| `finish`   | Player completed race     |
| `removed`  | Remove player from room   |

---

### Server → Client

| Type                 | Description                 |
| -------------------- | --------------------------- |
| `connected`          | Initial handshake           |
| `joined`             | Room assignment             |
| `room:update`        | Player list + phase         |
| `physics:update`     | Authoritative physics state |
| `pregame:tick`       | Lobby countdown             |
| `racecountdown:tick` | Race start countdown        |
| `race:start`         | Race begins                 |
| `race:end`           | Race completed              |
| `player:finished`    | Player finished event       |
| `server:log`         | Debug messages              |

---

## 🏁 Game Phases

```
lobby
  ↓
pregame
  ↓
racecountdown
  ↓
racing
  ↓
finished
```

Phase changes are broadcast to all players in the room.

---

## 🔧 Installation

```bash
npm install
```

Start the server:

```bash
node server/server.js
```

Or with environment variables:

```bash
PORT=3030 ALLOW_FORCE_START=true node server/server.js
```

---

## 🌍 Environment Variables

| Variable            | Description                 |
| ------------------- | --------------------------- |
| `PORT`              | Server port (default: 3030) |
| `ALLOW_FORCE_START` | Allows `startNow` override  |

---

## 🧩 Room Lifecycle

When the last player disconnects:

1. Timers are cleared
2. Physics worker is stopped
3. Worker is terminated
4. Room is deleted

```js
cleanupRoom(roomId, playerId);
```

This ensures zero orphaned workers.

---

## 🧪 Physics Model Summary

### Rotation

* Pitch = local X axis
* Roll = local forward axis
* Angular velocity damping
* Max angular clamp (`MAX_ANG`)

### Movement

* Signed speed via dot product
* Forward vector derived from quaternion
* Acceleration & braking model
* Velocity reconstructed from scalar speed
* Exponential smoothing toward target velocity

### Collision

* OBB corners sampled
* Signed distance to procedural planet
* Finite difference gradient normal
* Penetration resolution
* Restitution & slide factors

---

## 🧵 Worker Isolation Model

Each room creates:

```js
new Worker('./workers/PhysicsWorker.js')
```

This ensures:

* No shared physics state
* No cross-room bleed
* Scalable architecture
* CPU core utilization

---

## 🛠️ Future Improvements

* Matchmaking system
* Room persistence
* Spectator mode
* Replay system
* Lag compensation
* Snapshot delta compression
* Horizontal scaling via clustering

---

## 📦 Project Structure

```
server/
│
├── server.js
│
├── workers/
│   └── PhysicsWorker.js
│
├── fbm.js
└── math.js
```

---

## 🎮 Designed For

Nebula Grand Prix
A 3D planetary racing experience with procedural terrain and multiplayer competition.

---

If you'd like, I can also:

* Rewrite this as a **portfolio-optimized README**
* Add architecture diagrams
* Add a client integration section
* Or convert this into something more “startup ready” for investors or collaborators
