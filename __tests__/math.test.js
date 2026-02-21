import { describe, expect, test } from '@jest/globals';
import { Quaternion, Vector3 } from '../math.js';

describe('Vector3', () => {
  test('set, copy, and clone create expected values', () => {
    const a = new Vector3().set(1, 2, 3);
    const b = new Vector3().copy(a);
    const c = a.clone();

    expect(a).toEqual({ x: 1, y: 2, z: 3 });
    expect(b).toEqual({ x: 1, y: 2, z: 3 });
    expect(c).toEqual({ x: 1, y: 2, z: 3 });
    expect(c).not.toBe(a);
  });

  test('add, sub, and multiplyScalar mutate correctly', () => {
    const v = new Vector3(1, 2, 3);
    v.add(new Vector3(3, 2, 1));
    expect(v).toEqual({ x: 4, y: 4, z: 4 });

    v.sub(new Vector3(1, 1, 1));
    expect(v).toEqual({ x: 3, y: 3, z: 3 });

    v.multiplyScalar(2);
    expect(v).toEqual({ x: 6, y: 6, z: 6 });
  });

  test('dot, length, normalize, and lerp work as expected', () => {
    const a = new Vector3(3, 4, 0);
    const b = new Vector3(1, 2, 3);
    expect(a.dot(b)).toBe(11);
    expect(a.length()).toBe(5);

    a.normalize();
    expect(a.x).toBeCloseTo(0.6);
    expect(a.y).toBeCloseTo(0.8);
    expect(a.z).toBeCloseTo(0);

    const c = new Vector3(0, 0, 0).lerp(new Vector3(10, 20, 30), 0.25);
    expect(c).toEqual({ x: 2.5, y: 5, z: 7.5 });
  });

  test('applyQuaternion rotates vector around Y axis by 90 degrees', () => {
    const v = new Vector3(1, 0, 0);
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    v.applyQuaternion(q);

    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(-1, 6);
  });
});

describe('Quaternion', () => {
  test('set, copy, clone, length, and normalize work', () => {
    const q = new Quaternion().set(2, 0, 0, 0);
    expect(q.length()).toBe(2);
    q.normalize();
    expect(q.length()).toBeCloseTo(1);

    const a = new Quaternion(1, 2, 3, 4);
    const b = new Quaternion().copy(a);
    const c = a.clone();
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(c).not.toBe(a);
  });

  test('normalize handles zero quaternion by resetting to identity', () => {
    const q = new Quaternion(0, 0, 0, 0).normalize();
    expect(q).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  test('setFromAxisAngle handles zero-length axis by producing identity', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 0), 1.234);
    expect(q).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  test('multiply composes rotations in expected order', () => {
    const qx = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
    const qy = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    const composed = qx.clone().multiply(qy);

    const vStep = new Vector3(0, 0, 1).applyQuaternion(qy).applyQuaternion(qx);
    const vComposed = new Vector3(0, 0, 1).applyQuaternion(composed);

    expect(vComposed.x).toBeCloseTo(vStep.x, 6);
    expect(vComposed.y).toBeCloseTo(vStep.y, 6);
    expect(vComposed.z).toBeCloseTo(vStep.z, 6);
  });

  test('premultiply composes rotations in expected order', () => {
    const qx = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
    const qy = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    const composed = qx.clone().premultiply(qy);

    const vStep = new Vector3(0, 0, 1).applyQuaternion(qx).applyQuaternion(qy);
    const vComposed = new Vector3(0, 0, 1).applyQuaternion(composed);

    expect(vComposed.x).toBeCloseTo(vStep.x, 6);
    expect(vComposed.y).toBeCloseTo(vStep.y, 6);
    expect(vComposed.z).toBeCloseTo(vStep.z, 6);
  });
});
