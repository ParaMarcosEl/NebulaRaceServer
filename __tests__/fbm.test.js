import { describe, expect, test } from '@jest/globals';
import {
  add,
  fbmStandard,
  floorVec,
  fract,
  hash,
  noise,
  noiseArray,
  ridge,
  ridgedFBM,
  scale,
  sub,
  terrainElevationFBM,
  terrainElevationRidged,
  vec3,
} from '../fbm.js';

describe('fbm vector helpers', () => {
  test('vec3/add/sub/scale/floorVec/fract return expected values', () => {
    const a = vec3(1.2, -2.8, 3.5);
    const b = vec3(0.8, 2.8, -1.5);

    expect(add(a, b)).toEqual({ x: 2, y: 0, z: 2 });
    expect(sub(a, b)).toEqual({ x: 0.3999999999999999, y: -5.6, z: 5 });
    expect(scale(a, 2)).toEqual({ x: 2.4, y: -5.6, z: 7 });
    expect(floorVec(a)).toEqual({ x: 1, y: -3, z: 3 });
    expect(fract(3.75)).toBeCloseTo(0.75);
    expect(fract(-1.25)).toBeCloseTo(0.75);
  });
});

describe('noise primitives', () => {
  test('hash is deterministic and bounded to [0, 1)', () => {
    const p = vec3(1.234, -5.678, 9.1011);
    const a = hash(p);
    const b = hash(p);

    expect(a).toBeCloseTo(b, 12);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
  });

  test('noise is deterministic and bounded to [0, 1)', () => {
    const p = vec3(2.5, -1.25, 7.75);
    const a = noise(p);
    const b = noise(p);

    expect(a).toBeCloseTo(b, 12);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
  });

  test('noiseArray matches noise(vec3(...))', () => {
    const p = [0.25, 1.5, -3.75];
    expect(noiseArray(p)).toBeCloseTo(noise(vec3(p[0], p[1], p[2])), 12);
  });

  test('ridge maps values symmetrically around zero', () => {
    expect(ridge(0.2)).toBeCloseTo(ridge(-0.2), 12);
    expect(ridge(0)).toBeCloseTo(1);
    expect(ridge(1)).toBeCloseTo(0);
  });
});

describe('fbm accumulation', () => {
  test('fbmStandard uses freq/lacunarity/persistence across octaves', () => {
    const calls = [];
    const noiseFn = (p) => {
      calls.push([...p]);
      return 1;
    };

    const result = fbmStandard([1, 2, 3], 2, 3, 0.5, 3, noiseFn);

    expect(result).toBeCloseTo(0.875);
    expect(calls).toEqual([
      [2, 4, 6],
      [6, 12, 18],
      [18, 36, 54],
    ]);
  });

  test('ridgedFBM applies ridge transform before accumulation', () => {
    const noiseFn = () => 0.2;
    const result = ridgedFBM([1, 1, 1], 1, 2, 0.5, 2, noiseFn);

    // ridge(0.2) = (1 - |0.2|)^2 = 0.64, weighted by 0.5 and 0.25
    expect(result).toBeCloseTo(0.64 * 0.75);
  });
});

describe('terrain elevation', () => {
  const params = {
    uFrequency: 1.5,
    uLacunarity: 2,
    uPersistence: 0.5,
    uOctaves: 4,
    uExponentiation: 2,
  };

  test('terrainElevationFBM applies exponentiation to standard fbm', () => {
    const noiseFn = () => 0.5;
    const elevation = terrainElevationFBM([1, 2, 3], params, noiseFn);

    // fbm sum = 0.5 * (0.5 + 0.25 + 0.125 + 0.0625) = 0.46875
    expect(elevation).toBeCloseTo(0.46875 ** 2);
  });

  test('terrainElevationRidged returns deterministic value with deterministic noise', () => {
    const noiseFn = () => 0.5;
    const a = terrainElevationRidged([1, 2, 3], params, noiseFn);
    const b = terrainElevationRidged([1, 2, 3], params, noiseFn);

    expect(a).toBeCloseTo(b, 12);
    expect(a).toBeGreaterThanOrEqual(0);
  });
});
