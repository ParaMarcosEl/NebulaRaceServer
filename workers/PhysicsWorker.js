// server/workers/PhysicsWorker.js

import { parentPort } from 'worker_threads';
import { terrainElevationRidged, terrainElevationFBM } from '../fbm.js';
import { Vector3, Quaternion } from '../math.js';

// Utilities inside PhysicsWorker.js
function getStartPoseFromCurve(points, distance = 0) {
    const n = points.length;
    const t = Math.min(Math.max(distance, 0), 1);
    const index = t * (n - 1);
    const i0 = Math.floor(index);
    const i1 = Math.min(i0 + 1, n - 1);
    const alpha = index - i0;

    // Interpolated position
    const p0 = points[i0];
    const p1 = points[i1];
    const position = [
        p0[0] + (p1[0] - p0[0]) * alpha,
        p0[1] + (p1[1] - p0[1]) * alpha,
        p0[2] + (p1[2] - p0[2]) * alpha,
    ];

    // Tangent (forward direction)
    const tangent = [
        p1[0] - p0[0],
        p1[1] - p0[1],
        p1[2] - p0[2],
    ];
    const length = Math.hypot(tangent[0], tangent[1], tangent[2]);
    tangent[0] /= length;
    tangent[1] /= length;
    tangent[2] /= length;

    // Convert to quaternion: forward = [0,0,-1] rotated to tangent
    // Simple implementation: assume up = [0,1,0]
    const quat = lookRotation(tangent, [0, 1, 0]);

    return { position, quaternion: quat };
}

// Helper to convert forward/up to quaternion (like THREE.Quaternion.setFromUnitVectors)
function lookRotation(forward, up) {
    const z = [-forward[0], -forward[1], -forward[2]]; // Three.js looks along -Z
    const x = [
        up[1] * z[2] - up[2] * z[1],
        up[2] * z[0] - up[0] * z[2],
        up[0] * z[1] - up[1] * z[0],
    ];
    const lx = Math.hypot(x[0], x[1], x[2]);
    x[0] /= lx; x[1] /= lx; x[2] /= lx;

    const y = [
        z[1] * x[2] - z[2] * x[1],
        z[2] * x[0] - z[0] * x[2],
        z[0] * x[1] - z[1] * x[0],
    ];

    // Construct rotation matrix
    const m00 = x[0], m01 = y[0], m02 = z[0];
    const m10 = x[1], m11 = y[1], m12 = z[1];
    const m20 = x[2], m21 = y[2], m22 = z[2];

    // Convert rotation matrix to quaternion
    const tr = m00 + m11 + m22;
    let qw, qx, qy, qz;
    if (tr > 0) {
        const S = Math.sqrt(tr + 1.0) * 2;
        qw = 0.25 * S;
        qx = (m21 - m12) / S;
        qy = (m02 - m20) / S;
        qz = (m10 - m01) / S;
    } else if ((m00 > m11) && (m00 > m22)) {
        const S = Math.sqrt(1.0 + m00 - m11 - m22) * 2;
        qw = (m21 - m12) / S;
        qx = 0.25 * S;
        qy = (m01 + m10) / S;
        qz = (m02 + m20) / S;
    } else if (m11 > m22) {
        const S = Math.sqrt(1.0 + m11 - m00 - m22) * 2;
        qw = (m02 - m20) / S;
        qx = (m01 + m10) / S;
        qy = 0.25 * S;
        qz = (m12 + m21) / S;
    } else {
        const S = Math.sqrt(1.0 + m22 - m00 - m11) * 2;
        qw = (m10 - m01) / S;
        qx = (m02 + m20) / S;
        qy = (m12 + m21) / S;
        qz = 0.25 * S;
    }
    return [qx, qy, qz, qw];
}


function log(roomId, msg) {
  parentPort?.postMessage({
    type: 'PhysicsWorker:log',
    payload: { roomId, message: msg },
  });
}

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const isFiniteNum = (x) => Number.isFinite(x);

// =================================================================================
// #region CONSTANTS & STATE
// =================================================================================
const FIXED_STEP = 1 / 60;
const TICK_RATE_MS = FIXED_STEP * 1000;
let interval = null;
let running = false;
const MAX_ANG = 2.0; // rad/s

const playerRadius = 0.5;

let planetRadius = 0;
let fbmParams = null;
// let curvePoints = null;
let restitution = 0.0;
let slideFactor = 0.0;

const players = new Map(); // map of playerId -> state
let physicsInterval = null;

let curvePoints = null;       // Array of [x,y,z] points
let startPositions = null;    // Precomputed start poses along the curve
let nextStartIndex = 0;       // Tracks which start position to assign next

//#endregion

// =================================================================================
// #region TEMP OBJECTS (singletons reused across loop — NO allocations in loop)
// =================================================================================
const tmpForward = new Vector3(0, 0, -1);
const tmpRight = new Vector3();
const tmpPitchQuat = new Quaternion();
const tmpRollQuat = new Quaternion();
const tmpDesiredVel = new Vector3();
const _tmpA = new Vector3();
const _tmpB = new Vector3();
const _tmpCorner = new Vector3();
const _closestCorner = new Vector3();
const _obbResult = { distance: 0, normal: new Vector3(0, 1, 0) };
//#endregion

// =================================================================================
// #region TERRAIN
// =================================================================================
function signedDistanceToPlanet(p) {
  if (!fbmParams || planetRadius === 0) return 1000;
  // reuse _tmpA for normalized direction
  _tmpA.copy(p).normalize();
  const dirArr = [_tmpA.x, _tmpA.y, _tmpA.z];
  const raw = fbmParams.useRidged
    ? terrainElevationRidged(dirArr, fbmParams)
    : terrainElevationFBM(dirArr, fbmParams);
  const elevation = Math.max(0, raw * 0.5 + 0.5);
  const maxH = fbmParams.uMaxHeight ?? 10;
  return p.length() - (planetRadius + elevation * maxH);
}

// write the planet normal into 'out' (Vector3) to avoid allocations
function calculatePlanetNormal(p, out) {
  out.copy(p).normalize();
  return out;
}

function obbSignedDistanceWithNormal(center, halfExtents, orientation, out) {
  if (!fbmParams || planetRadius === 0) {
    out.distance = 1000;
    out.normal.set(0, 1, 0);
    return;
  }

  let minDist = Infinity;
  // reuse _tmpCorner and _closestCorner to find the closest corner
  for (let i = 0; i < 8; i++) {
    const sx = (i & 1) ? 1 : -1;
    const sy = (i & 2) ? 1 : -1;
    const sz = (i & 4) ? 1 : -1;
    _tmpCorner.set(sx * halfExtents.x, sy * halfExtents.y, sz * halfExtents.z)
      .applyQuaternion(orientation)
      .add(center);
    const d = signedDistanceToPlanet(_tmpCorner);
    if (d < minDist) {
      minDist = d;
      _closestCorner.copy(_tmpCorner);
    }
  }

  out.distance = minDist;

  // finite difference gradient — **no allocations**
  const eps = 0.5;

  // compute x-direction sample points into _tmpA/_tmpB (reused)
  // +eps x
  _tmpA.copy(_closestCorner).add(_tmpA.set(eps, 0, 0));
  const sxp = signedDistanceToPlanet(_tmpA);
  // -eps x
  _tmpA.copy(_closestCorner).add(_tmpA.set(-eps, 0, 0));
  const sxn = signedDistanceToPlanet(_tmpA);

  // +eps y
  _tmpA.copy(_closestCorner).add(_tmpA.set(0, eps, 0));
  const syp = signedDistanceToPlanet(_tmpA);
  // -eps y
  _tmpA.copy(_closestCorner).add(_tmpA.set(0, -eps, 0));
  const syn = signedDistanceToPlanet(_tmpA);

  // +eps z
  _tmpA.copy(_closestCorner).add(_tmpA.set(0, 0, eps));
  const szp = signedDistanceToPlanet(_tmpA);
  // -eps z
  _tmpA.copy(_closestCorner).add(_tmpA.set(0, 0, -eps));
  const szn = signedDistanceToPlanet(_tmpA);

  // set gradient components directly (no new Vector3)
  const gx = sxp - sxn;
  const gy = syp - syn;
  const gz = szp - szn;

  out.normal.set(gx, gy, gz).normalize();

  if (!isFiniteNum(out.normal.x) || out.normal.length() === 0) {
    // fallback — write directly into out.normal
    calculatePlanetNormal(_closestCorner, out.normal);
  }
}
// #endregion

function start() {
  if (running) return;
  running = true;
  interval = setInterval(() => {
    // Simulate physics tick
    parentPort.postMessage({ type: 'tick', timestamp: Date.now() });
  }, TICK_RATE_MS);
}

function stop() {
  running = false;
  clearInterval(interval);
  interval = null;
}

// =================================================================================
// #region PHYSICS LOOP (allocation-free per-player updates)
// =================================================================================

function updatePlayerPhysics(state) {
    // state is an object with { pos, rot, velocity, angularVelocity, throttle, inputX, inputY, accel, pitchVel, rollVel, damping, playerSpeed }
    // reuse globals tmp* for all vector math
    // local references for brevity and to avoid repeated Map lookups
    const pos = state.pos;
    const rot = state.rot;
    const velocity = state.velocity;
    const angularVelocity = state.angularVelocity;


    const dt = FIXED_STEP;
    const accel = state.accel;
    const pitchVel = state.pitchVel;
    const rollVel = state.rollVel;
    const damping = state.damping;
    const throttle = state.throttle;
    const inputX = state.inputX;
    const inputY = state.inputY;
    const currentPlayerSpeed = state.playerSpeed;

    // --- REFACTORED ANGULAR VELOCITY AND ROTATION LOGIC ---

    // 1. Update Angular Velocity (Instantaneous Input + Damping)
    angularVelocity.x = inputY * pitchVel;
    angularVelocity.z = inputX * rollVel;

    // Apply damping (drag) to angular velocity unconditionally
    angularVelocity.multiplyScalar(Math.pow(damping, dt));

    // Clamp angular velocity (Max rotation rate)
    angularVelocity.x = clamp(angularVelocity.x, -MAX_ANG, MAX_ANG);
    angularVelocity.z = clamp(angularVelocity.z, -MAX_ANG, MAX_ANG);

    // 2. Rotation Application (Sequential)
    // tmpRight = (1,0,0) rotated by rot (Pitch Axis)
    tmpRight.set(1, 0, 0).applyQuaternion(rot).normalize();
    // tmpForward = (0,0,1) rotated by rot (Roll Axis)
    tmpForward.set(0, 0, 1).applyQuaternion(rot).normalize(); // Note: Roll is typically around the forward axis

    // Calculate rotation quaternions for pitch and roll separately
    tmpPitchQuat.setFromAxisAngle(tmpRight, angularVelocity.x * FIXED_STEP);
    tmpRollQuat.setFromAxisAngle(tmpForward, angularVelocity.z * FIXED_STEP);

    // Apply the rotations: Pitch first (local X), then Roll (local Z/Forward)
    rot.premultiply(tmpRollQuat).premultiply(tmpPitchQuat).normalize();
    
    // --- END ROTATION REFACTOR ---

   // --- REFACTORED LINEAR MOTION LOGIC (Speed-Based) ---
    
    // 1. Calculate the ship's true forward vector: (0, 0, -1) applied by rot.
    // This MUST be done first to determine the ship's current orientation.
    tmpForward.set(0, 0, -1).applyQuaternion(rot).normalize(); 
    
    // --- Determine SIGNED Speed (The Fix) ---
    // Use the dot product (V_current . Forward_vector) to get the speed component
    // along the ship's axis, preserving the sign (positive = forward, negative = backward).
    let speed = velocity.dot(tmpForward); 

    // Use the scalar speed for clamping and acceleration/braking
    const maxSpeed = Math.max(0.0001, currentPlayerSpeed || 1);
    const maxBrakeSpeed = -maxSpeed * 0.5;
    const ABS_SPEED_LIMIT = maxSpeed * 4;
    

    // 2. UPDATE SPEED SCALAR (Thrust/Braking)
    if (throttle > 0) {
        // Accelerate forward (pushes speed toward maxSpeed)
        speed = Math.min(speed + accel * throttle * FIXED_STEP, maxSpeed);
    } else if (throttle < 0) {
        // Apply reverse thrust (pushes speed toward maxBrakeSpeed, which is negative)
        speed = Math.max(speed + accel * throttle * FIXED_STEP, maxBrakeSpeed);
    } else {
        // Drag/Damping when throttle is neutral
        const dtNormalized = 1.0; // Using normalized step for decay from reference
        speed *= Math.pow(0.99, dtNormalized);
    }

    // Clamp speed magnitude to prevent runaway
    speed = clamp(speed, -ABS_SPEED_LIMIT, ABS_SPEED_LIMIT);
    
    // 3. RECONSTRUCT VELOCITY VECTOR (Lerping to new desired vector)
    // tmpForward is already set above.
    // tmpDesiredVel = ForwardVector * signed speed.
    tmpDesiredVel.copy(tmpForward).multiplyScalar(speed);

    // Exponential smoothing/Lerp towards the desired velocity vector
    const SMOOTHING_RATE = 8.0; // Assuming this constant is defined elsewhere
    const lerpAlpha = Math.min(1, 1 - Math.exp(-SMOOTHING_RATE * Math.min(dt, 2)));
    const safeAlpha = clamp(lerpAlpha, 0, 1);

    velocity.lerp(tmpDesiredVel, safeAlpha);

    // Additional clamping (sanity check from reference)
    const velLen = velocity.length();
    if (velLen > ABS_SPEED_LIMIT) {
        velocity.multiplyScalar(ABS_SPEED_LIMIT / velLen);
    }
    
    // 4. INTEGRATE POSITION
    tmpDesiredVel.copy(velocity).multiplyScalar(FIXED_STEP);
    pos.add(tmpDesiredVel);

    // --- END LINEAR MOTION REFACTOR ---


    // collision / signed distance — reuses _tmpA/_tmpB/_tmpCorner/_closestCorner/_obbResult
    obbSignedDistanceWithNormal(pos, _tmpA.set(1.0, 0.5, 2.0), rot, _obbResult);

    const distance = _obbResult.distance;
    const normal = _obbResult.normal;

    if (distance < playerRadius) {
        const penetration = playerRadius - distance;

        pos.x += normal.x * penetration;
        pos.y += normal.y * penetration;
        pos.z += normal.z * penetration;

        const vDotN = velocity.x * normal.x + velocity.y * normal.y + velocity.z * normal.z;

        // _tmpB = normal * vDotN
        _tmpB.set(normal.x * vDotN, normal.y * vDotN, normal.z * vDotN);

        // _tmpCorner = velocity - _tmpB (reuse _tmpCorner)
        _tmpCorner.set(velocity.x - _tmpB.x, velocity.y - _tmpB.y, velocity.z - _tmpB.z);

        _tmpB.multiplyScalar(-restitution);
        _tmpCorner.multiplyScalar(slideFactor);

        velocity.x = _tmpCorner.x + _tmpB.x;
        velocity.y = _tmpCorner.y + _tmpB.y;
        velocity.z = _tmpCorner.z + _tmpB.z;

        angularVelocity.multiplyScalar(0.1);
    }
}

function updatePhysics() {
  // iterate players and update each one (no allocations)
  for (const [, state] of players) {
    // log(null, 'Updating player physics for state: ' +JSON.stringify(state));
    updatePlayerPhysics(state);
  }

  // produce aggregated state object (small allocations of arrays only for IPC — unavoidable here)
  const out = {};
  for (const [id, state] of players) {
    out[id] = {
      pos: [state.pos.x, state.pos.y, state.pos.z],
      rot: [state.rot.x, state.rot.y, state.rot.z, state.rot.w],
      velocity: [state.velocity.x, state.velocity.y, state.velocity.z],
      angularVelocity: [state.angularVelocity.x, state.angularVelocity.y, state.angularVelocity.z],
    };
  }

  parentPort?.postMessage({ type: 'stateUpdate', state: out });
}
// #endregion

// =================================================================================
// #region MESSAGE HANDLING
// =================================================================================
function startFixedUpdateLoop() {
  log(null, 'Server physics worker fixed-step loop started.');
  if (physicsInterval) clearInterval(physicsInterval);
  physicsInterval = setInterval( () =>{
    updatePhysics();
  }, TICK_RATE_MS);
}

function init(data) {
  if (data.planetSize !== undefined) planetRadius = data.planetSize;
  if (data.fbmParams) fbmParams = data.fbmParams;
  if (data.curvePoints) {
    curvePoints = data.curvePoints;

    // Precompute start positions along curve
    const numPositions = curvePoints.length;
    startPositions = curvePoints.map((_, i) =>
      getStartPoseFromCurve(curvePoints, i / Math.max(1, numPositions - 1))
    );


    console.log('Precomputed start positions:', startPositions);
    nextStartIndex = 0;
  }
  if (data.restitution) restitution = data.restitution;
  if (data.slideFactor) slideFactor = data.slideFactor;
  log(null, 'Calling startFixedUpdateLoop from init');
  startFixedUpdateLoop();
}

function handleConfig(data) {
  const playerId = data.playerId;
  const state = players.get(playerId);
  if (!state) return;

  // Update max speed parameters based on client config
  if (data.playerSpeed !== undefined) state.playerSpeed = data.playerSpeed;
  // NOTE: You'll also need to update accel, pitchVel, and rollVel 
  // if the client intends to send them via 'config'
  if (data.acceleration !== undefined) state.accel = data.acceleration;
  if (data.pitchVelocity !== undefined) state.pitchVel = data.pitchVelocity;
  if (data.rollVelocity !== undefined) state.rollVel = data.rollVelocity;
}


// Add a player — keeps file structure minimal while adding player state
function addPlayer(data) {
  const playerId = data.playerId;
  if (!playerId) return;
  if (!fbmParams) fbmParams = data.fbmParams || null;
  if (!curvePoints && data.curvePoints) {
    log(null, `Assigning curve points for player ${playerId}`);
    curvePoints = data.curvePoints;
    // Precompute start positions along curve
    const numPositions = curvePoints.length;
    startPositions = curvePoints.map((_, i) =>
      getStartPoseFromCurve(curvePoints, i / Math.max(1, numPositions - 1))
    );
    nextStartIndex = 0;
  }
  // Determine starting position
  let startPose;
  if (startPositions && startPositions.length > 0) {
    log(null, `Assigning start position for player ${playerId} at index ${nextStartIndex}`);
    startPose = startPositions[nextStartIndex % startPositions.length];
    nextStartIndex++;
  } else {
    log(null, `Assigning default start position for player ${playerId}`);
    startPose = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
  }

  // create state with preallocated Vector3/Quaternion instances per-player
  const state = {
    pos: new Vector3(...(data.position ?? startPose.position)),
    rot: new Quaternion(...startPose.quaternion),
    velocity: new Vector3(),
    angularVelocity: new Vector3(),

    // input and config
    throttle: 0,
    inputX: 0,
    inputY: 0,
    accel: data.acceleration ?? 20,
    pitchVel: data.pitchVelocity ?? 3,
    rollVel: data.rollVelocity ?? 6,
    damping: data.damping ?? 0.998,
    playerSpeed: data.playerSpeed ?? 50,
  };

  players.set(playerId, state);
}


function removePlayer(data) {
  const playerId = data.playerId;
  if (!playerId) return;
  players.delete(playerId);
  log(null, `Removed player ${playerId}`);
}

function handleInput(data) {
  log(null, `\nhandleInput called with \ndata: ${JSON.stringify({...data, curvePoints: undefined}, null, 2)}`);
  const playerId = data.playerId;
  const state = players.get(playerId);
  if (!state) return;

  if (data.throttle !== undefined) state.throttle = data.throttle;
  if ("inputAxis" in data) {
      state.inputX = data.inputAxis.x;
      state.inputY = data.inputAxis.y;
  }
}

if (parentPort) {
  parentPort.postMessage({ type: 'ready' });
  parentPort.on('message', (data) => {
    const { type } = data && data.type ? data : {};
    
    if (type === 'addPlayer') addPlayer(data);
    else if (type === 'removePlayer') removePlayer(data);
    else if (type === 'config') handleConfig(data);
    else if (type === 'start') start();
    else if (type === 'stop') stop();
    if (type === 'init') init(data);
    else if (type === 'input') handleInput(data);

  });
}
// #endregion
