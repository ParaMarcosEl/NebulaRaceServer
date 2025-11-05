// server/index.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3030;

/*
 Simple in-memory game state (single room for simplicity)
 - For production: move to Redis or DB if you need multi-instance scaling
*/

const state = {
  room: {
    id: 'main',
    players: {}, // playerId -> {id, name, socket, ready, position, score, outOfBoundsTime}
    phase: 'lobby', // lobby, pregame, racecountdown, racing, finished
    pregameTimer: null,
    raceTimer: null,
    raceStartAt: null,
  }
};

// helper send
function send(ws, type, payload) {
  const msg = JSON.stringify({ type, payload });
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(msg);
}

// broadcast to everyone
function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

function broadcastRoomState() {
  const players = Object.values(state.room.players).map(p => ({
    id: p.id,
    name: p.name,
    position: p.position ?? null,
    score: p.score ?? 0,
    outOfBoundsTime: p.outOfBoundsTime || 0,
    ready: !!p.ready
  }));
  broadcast('room:update', { phase: state.room.phase, players });
}

// assign race start positions (simple ordering)
function assignStartPositions() {
  const players = Object.values(state.room.players);
  players.sort((a,b) => a.joinedAt - b.joinedAt);
  players.forEach((p, i) => {
    p.position = i + 1;
  });
}

function startPregameCountdown(seconds = 10) {
  if (state.room.phase !== 'lobby') return;
  state.room.phase = 'pregame';
  let t = seconds;
  broadcast('pregame:tick', { seconds: t });
  state.room.pregameTimer = setInterval(() => {
    t--;
    if (t <= 0) {
      clearInterval(state.room.pregameTimer);
      state.room.pregameTimer = null;
      // assign positions and start race countdown
      assignStartPositions();
      broadcastRoomState();
      startRaceCountdown(5); // 5s race start countdown
    } else {
      broadcast('pregame:tick', { seconds: t });
    }
  }, 1000);
  broadcastRoomState();
}

function startRaceCountdown(seconds = 5) {
  state.room.phase = 'racecountdown';
  let t = seconds;
  broadcast('racecountdown:tick', { seconds: t });
  state.room.raceTimer = setInterval(() => {
    t--;
    if (t <= 0) {
      clearInterval(state.room.raceTimer);
      state.room.raceTimer = null;
      startRace();
    } else {
      broadcast('racecountdown:tick', { seconds: t });
    }
  }, 1000);
  broadcastRoomState();
}

function startRace() {
  state.room.phase = 'racing';
  state.room.raceStartAt = Date.now();
  broadcast('race:start', { startedAt: state.room.raceStartAt });
  broadcastRoomState();
  // NOTE: For a real game, you'd likely start a tight tick loop (30-60Hz) to send positions.
}

function endRace() {
  state.room.phase = 'finished';
  broadcast('race:end', {});
  broadcastRoomState();
}

wss.on('connection', (ws) => {
  const playerId = uuidv4();
  ws.playerId = playerId;

  // initial handshake
  send(ws, 'connected', { playerId });

  ws.on('message', (msg) => {
    let data;
    try { data = JSON.parse(msg); } catch (e) { return; }
    const { type, payload } = data;

    if (type === 'join') {
      const { name } = payload || {};
      state.room.players[playerId] = {
        id: playerId,
        name: name || 'anon',
        socket: ws,
        joinedAt: Date.now(),
        ready: false,
        score: 0,
        outOfBoundsTime: 0
      };
      send(ws, 'joined', { playerId, roomId: state.room.id });
      broadcastRoomState();
    }

    if (type === 'setReady') {
      const p = state.room.players[playerId];
      if (!p) return;
      p.ready = !!payload.ready;
      broadcastRoomState();

      // if all players ready, start pregame
      const players = Object.values(state.room.players);
      if (players.length >= 1 && players.every(pl => pl.ready) && state.room.phase === 'lobby') {
        startPregameCountdown(10);
      }
    }

    if (type === 'player:update') {
      // Player sends their position / telemetry during race
      const p = state.room.players[playerId];
      if (!p) return;
      // payload should include: { x, y, z, outOfBounds }
      p.lastTelemetry = payload;
      // track out of bounds
      if (payload.outOfBounds) {
        p.outOfBoundsTime = (p.outOfBoundsTime || 0) + (payload.dt || 0); // expect client to provide dt in ms
      }
      // Broadcast telemetry to others (you may want to limit frequency)
      broadcast('player:telemetry', { id: p.id, telemetry: payload });
    }

    if (type === 'finish') {
      const p = state.room.players[playerId];
      if (!p) return;
      p.finishedAt = Date.now();
      p.score = (p.score || 0) + 1;
      broadcast('player:finished', { id: playerId, finishedAt: p.finishedAt });
      // optional: end race when all finished
      const allFinished = Object.values(state.room.players).every(pl => pl.finishedAt);
      if (allFinished) endRace();
    }

    if (type === 'startNow' && process.env.ALLOW_FORCE_START === 'true') {
      // debug: force start
      startPregameCountdown(3);
    }
  });

  ws.on('close', () => {
    // cleanup
    delete state.room.players[playerId];
    broadcastRoomState();
  });
});

app.get('/', (req, res) => res.send('Game server live'));

server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
