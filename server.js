// server/server.js
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { Worker } from 'worker_threads';
import path from 'path';

// Log Throttle
export function createLogThrottle(limitPerSecond = 2) {
    const interval = 1000 / limitPerSecond; // ms between allowed logs
    let lastTime = 0;

    return function throttledLog(...args) {
        const now = Date.now();
        if (now - lastTime >= interval) {
            lastTime = now;
            log(...args);
        }
    };
}


// const logUpdate = createLogThrottle(1);

// --- Constants ---
const MAX_PLAYERS_PER_ROOM = 8;
// -----------------

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3030;

const state = {
  // Rooms object, keyed by room ID
  rooms: {
    // Initial default room
    // main: {
    //   id: '111-1111-1111-11-11111',
    //   stage: '/stages/stage1',
    //   players: {}, // keyed by player ID
    //   phase: 'lobby',
    //   pregameTimer: null,
    //   raceTimer: null,
    //   raceStartAt: null,
    // },
  },
};

function log(msg, roomId = null) {
  console.log(msg);
  const data = JSON.stringify({ type: 'server:log', payload: { message: msg } });
  wss.clients.forEach(c => {
    if (c.readyState === c.OPEN && (!roomId || c.roomId === roomId)) {
      c.send(data);
    }
  });
}

// Helper to get a room
function getRoom(roomId) {
  return state.rooms[roomId];
}

// Find or create an open room
function getOrCreateOpenRoom({ playerId, name, fbmParams, curvePoints, ws, stage = '/stages/stage1' } = {}) {
  log('Searching for open room...');
  for (const roomId in state.rooms) {
    const room = state.rooms[roomId];
    const playerCount = Object.keys(room.players).length;
    if (room.phase === 'lobby' && playerCount < MAX_PLAYERS_PER_ROOM) {
      log(`Found open room: ${roomId}`);
      return room;
    }
  }

  log('No open room found, creating new room...');
  const newRoomId = uuidv4();
  const newRoom = {
    id: newRoomId,
    players: {},
    phase: 'lobby',
    stage,
    pregameTimer: null,
    raceTimer: null,
    raceStartAt: null,
    physicsWorker: null,
  };

  // === Instantiate Physics Worker ===
const workerPath = path.resolve('./workers/PhysicsWorker.js');
const worker = new Worker(workerPath);
newRoom.physicsWorker = worker;

let workerReady = false;

// Queue any messages we want to send before ready
const pendingMessages = [];

// Send safely to worker
const sendToWorker = (msg) => {
  if (workerReady) {
    worker.postMessage(msg);
  } else {
    pendingMessages.push(msg);
  }
};

// Wait for worker to signal readiness
worker.once('message', (msg) => {
  if (msg.type === 'ready') {
    workerReady = true;

    // Flush queued messages
    for (const m of pendingMessages) worker.postMessage(m);
    pendingMessages.length = 0;

    // Now it's safe to send init/start
    sendToWorker({
      type: 'init',
      fbmParams,
      curvePoints,
      planetSize: fbmParams?.planetSize || 350,
      restitution: 0.0,
      slideFactor: 0.0,
    });

    sendToWorker({ type: 'start' });

    // Add player if needed
    if (playerId) {
      sendToWorker({
        type: 'addPlayer',
        playerId,
        position: [0, 0, 0],
        acceleration: 1.0,
        pitchVelocity: 1.0,
        rollVelocity: 1.0,
        damping: 0.998,
        playerSpeed: 1.0,
        fbmParams: fbmParams || {},
        curvePoints: curvePoints || [],
      });
    }
  }
});

  // Listen for messages from physics worker
  worker.on('message', (msg) => {
    const { type, state, payload } = msg;

    if (type === 'PhysicsWorker:log') {
      log(`[PhysicsWorker ${newRoomId}] ${payload.message}`);
      return;
    } 

    if (type === 'tick') {
      // ignore for now
    } else if (type === 'stateUpdate') {
      broadcast(newRoomId, 'physics:update', { state });
    }
  });

  worker.on('error', (err) => {
    log(`Physics worker for room ${newRoomId} error: ${err.stack || err}`);
  });
  worker.on('exit', (code) => {
    log(`Physics worker for room ${newRoomId} exited with code ${code}`);
    if (state.rooms[newRoomId]) state.rooms[newRoomId].physicsWorker = null;
  });

  // ✅ Add player immediately upon room initialization
  if (playerId) {
    newRoom.players[playerId] = { 
      id: playerId,
      name: name || 'anon',
      socket: ws || null,
      joinedAt: Date.now(),
      ready: false,
      score: 0,
      outOfBoundsTime: 0
    };

    if (worker) {
      worker.postMessage({
        type: 'addPlayer',
        playerId,
        position: [0, 0, 0],
        acceleration: 1.0,
        pitchVelocity: 1.0,
        rollVelocity: 1.0,
        damping: 0.998,
        playerSpeed: 1.0,
        fbmParams: fbmParams || {},
        curvePoints: curvePoints || [],
      });
    }
  }

  state.rooms[newRoomId] = newRoom;
  log(`Created new room [${newRoomId}] with ${Object.keys(newRoom.players).length} player(s).`);
  return newRoom;
}

function send(ws, type, payload) {
  const msg = JSON.stringify({ type, payload });
  if (ws && ws.readyState === ws.OPEN) ws.send(msg);
}

// Updated Broadcast function (targets only clients in the specified roomId)
function broadcast(roomId, type, payload) {
  const room = getRoom(roomId);
  if (!room) return;
  const msg = JSON.stringify({ type, payload });
  // Iterate only over clients that are in this specific room
  wss.clients.forEach(client => {
    if (client.readyState === client.OPEN && client.roomId === roomId) {
      client.send(msg);
    }
  });
}

// Updated broadcastRoomState function
function broadcastRoomState(roomId) {
  const room = getRoom(roomId);
  if (!room) return;
  
  const players = Object.values(room.players).map(p => ({
    id: p.id,
    name: p.name,
    position: p.position ?? null,
    score: p.score ?? 0,
    outOfBoundsTime: p.outOfBoundsTime || 0,
    ready: !!p.ready
  }));
  // Pass the roomId to the broadcast function
  broadcast(roomId, 'room:update', { phase: room.phase, players });
}

function assignStartPositions(roomId) {
  const room = getRoom(roomId);
  if (!room) return;
  
  const players = Object.values(room.players);
  players.sort((a, b) => a.joinedAt - b.joinedAt);
  players.forEach((p, i) => { p.position = i + 1; });
}

function cleanupRoom(roomId, playerId) {
  const room = getRoom(roomId);
  if (!room) return;
  clearInterval(room.pregameTimer);
  clearInterval(room.raceTimer);

  if (room.physicsWorker) {
  room.physicsWorker.postMessage({ type: 'removePlayer',  playerId });
    room.physicsWorker.postMessage({ type: 'stop' });
    room.physicsWorker.terminate();
    room.physicsWorker = null;
  }

  delete state.rooms[roomId];
  log(`Cleaned up room ${roomId}`);
}



function startPregameCountdown(roomId, seconds = 10) {
  const room = getRoom(roomId);
  if (!room || room.phase !== 'lobby') return;
  
  room.phase = 'pregame';
  let t = seconds;

  room.pregameTimerStart = Date.now();
  room.pregameDuration = seconds;

  // Use room.pregameTimer to manage timer specific to this room
  room.pregameTimer = setInterval(() => {
    t--;
    if (t <= 0) {
      clearInterval(room.pregameTimer);
      room.pregameTimer = null;
      assignStartPositions(roomId); // Pass roomId
      broadcastRoomState(roomId);
      startRaceCountdown(roomId, 5); // Pass roomId
    } else {
      broadcast(roomId, 'pregame:tick', { seconds: t }); // Pass roomId
    }
  }, 1000);
  broadcastRoomState(roomId);
}

function startRaceCountdown(roomId, seconds = 5) {
  const room = getRoom(roomId);
  if (!room) return;

  room.phase = 'racecountdown';
  let t = seconds;

  broadcast(roomId, 'racecountdown:tick', { seconds: t });
  room.raceTimer = setInterval(() => {
    t--;
    if (t <= 0) {
      clearInterval(room.raceTimer);
      room.raceTimer = null;
      startRace(roomId);
    } else {
      broadcast(roomId, 'racecountdown:tick', { seconds: t });
    }
  }, 1000);

  broadcastRoomState(roomId);
}

function startRace(roomId) {
  const room = getRoom(roomId);
  if (!room) return;

  room.phase = 'racing';
  room.raceStartAt = Date.now();
  broadcast(roomId, 'race:start', { startedAt: room.raceStartAt });
  broadcastRoomState(roomId);
}

function endRace(roomId) {
  const room = getRoom(roomId);
  if (!room) return;

  room.phase = 'finished';
  broadcast(roomId, 'race:end', {});
  broadcastRoomState(roomId);
}

wss.on('connection', (ws) => {
  const playerId = uuidv4();
  ws.playerId = playerId;

  send(ws, 'connected', { playerId });
  log(`Player connected: ${playerId}`);
  
  ws.on('message', (msg) => {
    let data;
    try { data = JSON.parse(msg); } catch { return; }
    const { type, payload } = data;

    if (type === 'join') {
      const { name, fbmParams, curvePoints } = payload || {};
      log('Joined with Payload: ' + JSON.stringify({...payload, curvePoints: []}));

      // ✅ Pass player info so player is added when room initializes
      const room = getOrCreateOpenRoom({ playerId, name, fbmParams, curvePoints, ws });
      const roomId = room.id;

      ws.roomId = roomId;

      // Only add player if not already created (e.g. room reused)
      if (!room.players[playerId]) {
        room.players[playerId] = { 
          id: playerId,
          name: name || 'anon',
          socket: ws,
          joinedAt: Date.now(),
          ready: false,
          score: 0,
          outOfBoundsTime: 0
        };

        if (room.physicsWorker) {
          room.physicsWorker.postMessage({
            type: 'addPlayer',
            playerId,
            position: [0, 0, 0],
            acceleration: 1.0,
            pitchVelocity: 1.0,
            rollVelocity: 1.0,
            damping: 0.998,
            playerSpeed: 1.0,
            fbmParams: fbmParams || {},
            curvePoints: curvePoints || [],
          });
        }
      }

      send(ws, 'joined', { playerId, roomId, fbmParams, curvePoints });
      broadcastRoomState(roomId);
    }


    if (type === 'removed') {


      const roomId = ws.roomId;
      if (!roomId) return;
      const room = getRoom(roomId);
      if (!room) return;
      const p = room.players[playerId];
      if (!p) return;

      
      if (room.physicsWorker) {
        room.physicsWorker.postMessage({ type: 'removePlayer', playerId });
      }

      delete room.players[playerId];
      send(ws, 'removed', { playerId });
      broadcastRoomState(roomId); 
    }

    const roomId = ws.roomId;
    if (!roomId) return; // Ignore messages if player hasn't joined a room

    if (type === 'setReady') {
      const room = getRoom(roomId);
      const p = room.players[playerId];
      if (!p) return;
      p.ready = !!payload.ready;
      broadcastRoomState(roomId); 

      // const players = Object.values(room.players);
      // if (players.length >= 1 && players.every(pl => pl.ready) && room.phase === 'lobby') {
      //   startPregameCountdown(roomId, 10); 
      // }
    }

    if (type === 'input') {
      const room = getRoom(roomId);
      const p = room.players[playerId];
      if (!p) return;
      broadcast(roomId, 'input', { playerId: p.id, ...payload });

      if (room.physicsWorker) {
        room.physicsWorker.postMessage({
          type: 'input',
          playerId,
          // include throttle and axis etc. — match worker.handleInput expectations:
          throttle: payload.throttle,
          inputAxis: payload.inputAxis, // { x, y } or whatever you send
          // include other fields as needed
        });
      }
    }

    if (type === 'config') {
    const room = getRoom(roomId);
    if (!room) return;
    
    // Pass config directly to the worker
    if (room.physicsWorker) {
        room.physicsWorker.postMessage({
            type: 'config', 
            playerId,
            ...payload, 
        });
    }
}

if (type === 'finish') {
  const room = getRoom(roomId);
  const p = room?.players[playerId];
  if (!p) return;
  p.finishedAt = Date.now();
  p.score = (p.score || 0) + 1;
  broadcast(roomId, 'player:finished', { id: playerId, finishedAt: p.finishedAt });

  const allFinished = Object.values(room.players).every(pl => pl.finishedAt);
  if (allFinished) endRace(roomId);
}

    if (type === 'startNow' && process.env.ALLOW_FORCE_START === 'true') {
        startPregameCountdown(roomId, 3);
      }
  });

  ws.on('close', () => {
    const roomId = ws.roomId;
    if (roomId) {
      const room = getRoom(roomId);
      if (room && Object.keys(room.players).length === 0) {
        clearInterval(room.pregameTimer);
        clearInterval(room.raceTimer);
        delete state.rooms[roomId];
        log(`Deleted empty room: ${roomId}`);
      }
      cleanupRoom(roomId, playerId);
    }

  });
});

app.get('/', (req, res) => res.send('Game server live'));

server.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`)
  log(`Server listening`);
});
