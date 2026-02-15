/**
 * Simple FBM noise utilities for terrain elevation (Node.js version)
 * Converted from client TypeScript version — no THREE.js dependency
 */

// === Vector3 utilities ===
export function vec3(x = 0, y = 0, z = 0) {
  return { x, y, z };
}

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a, s) {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function floorVec(a) {
  return { x: Math.floor(a.x), y: Math.floor(a.y), z: Math.floor(a.z) };
}

export function fract(x) {
  return x - Math.floor(x);
}

// === Noise utilities ===
export function hash(p) {
  const v = add(scale(p, 0.3183099), vec3(0.1, 0.1, 0.1));
  return fract(v.x * v.y * v.z * (v.x + v.y + v.z));
}

export function noise(p) {
  const i = floorVec(p);
  const f = sub(p, i);

  const fade = (t) => t * t * (3 - 2 * t);
  const fx = fade(f.x);
  const fy = fade(f.y);
  const fz = fade(f.z);
  const mix = (a, b, t) => a * (1 - t) + b * t;

  const n000 = hash(i);
  const n100 = hash(add(i, vec3(1, 0, 0)));
  const n010 = hash(add(i, vec3(0, 1, 0)));
  const n110 = hash(add(i, vec3(1, 1, 0)));
  const n001 = hash(add(i, vec3(0, 0, 1)));
  const n101 = hash(add(i, vec3(1, 0, 1)));
  const n011 = hash(add(i, vec3(0, 1, 1)));
  const n111 = hash(add(i, vec3(1, 1, 1)));

  const x00 = mix(n000, n100, fx);
  const x10 = mix(n010, n110, fx);
  const x01 = mix(n001, n101, fx);
  const x11 = mix(n011, n111, fx);
  const y0 = mix(x00, x10, fy);
  const y1 = mix(x01, x11, fy);

  return mix(y0, y1, fz);
}

export function noiseArray(p) {
  return noise(vec3(p[0], p[1], p[2]));
}

// === FBM ===
export function ridge(n) {
  n = Math.abs(n);
  n = 1.0 - n;
  return n * n;
}

export function fbmStandard(p, freq, lacunarity, persistence, octaves, noiseFn = noiseArray) {
  let sum = 0;
  let amp = 0.5;
  let f = freq;
  for (let i = 0; i < octaves; i++) {
    sum += noiseFn([p[0] * f, p[1] * f, p[2] * f]) * amp;
    f *= lacunarity;
    amp *= persistence;
  }
  return sum;
}

export function ridgedFBM(p, freq, lacunarity, persistence, octaves, noiseFn = noiseArray) {
  let sum = 0;
  let amp = 0.5;
  let f = freq;
  for (let i = 0; i < octaves; i++) {
    sum += ridge(noiseFn([p[0] * f, p[1] * f, p[2] * f])) * amp;
    f *= lacunarity;
    amp *= persistence;
  }
  return sum;
}

// === Terrain Elevation Functions ===
export function terrainElevationFBM(pos, params, noiseFn = noiseArray) {
  const { uFrequency, uLacunarity, uPersistence, uOctaves, uExponentiation } = params;
  const elevation = fbmStandard(pos, uFrequency, uLacunarity, uPersistence, uOctaves, noiseFn);
  return Math.pow(elevation, uExponentiation);
}

export function terrainElevationRidged(pos, params, noiseFn = noiseArray) {
  const { uFrequency, uLacunarity, uPersistence, uOctaves, uExponentiation } = params;

  const base = ridgedFBM(pos, uFrequency, uLacunarity, uPersistence, uOctaves, noiseFn);

  const warp = [
    noiseFn([pos[0] * 0.5, pos[1] * 0.5, pos[2] * 0.5]),
    noiseFn([pos[0] * 0.5 + 100, pos[1] * 0.5, pos[2] * 0.5]),
    noiseFn([pos[0] * 0.5, pos[1] * 0.5 + 200, pos[2] * 0.5]),
  ];
  const warpedPos = [
    pos[0] + warp[0] * 0.3,
    pos[1] + warp[1] * 0.3,
    pos[2] + warp[2] * 0.3,
  ];

  const detail = ridgedFBM(
    warpedPos,
    uFrequency * 2.5,
    uLacunarity,
    uPersistence,
    Math.max(3, Math.floor(uOctaves / 2)),
    noiseFn
  );

  return Math.pow(base + detail * 0.3, uExponentiation);
}
