import { describe, expect, jest, test } from '@jest/globals';
import { Quaternion, Vector3 } from '../math.js';
import { createThrottle, getStartPoseFromCurve, lookRotation } from '../utils.js';

function rotateForwardByQuatArray(quatArray) {
  const q = new Quaternion(quatArray[0], quatArray[1], quatArray[2], quatArray[3]);
  return new Vector3(0, 0, -1).applyQuaternion(q);
}

describe('getStartPoseFromCurve', () => {
  test('interpolates position along curve and clamps distance', () => {
    const points = [
      [0, 0, 0],
      [10, 0, 0],
      [20, 0, 0],
    ];

    const mid = getStartPoseFromCurve(points, 0.5);
    expect(mid.position).toEqual([10, 0, 0]);

    const low = getStartPoseFromCurve(points, -2);
    expect(low.position).toEqual([0, 0, 0]);

    const high = getStartPoseFromCurve(points, 2);
    expect(high.position).toEqual([20, 0, 0]);
  });

  test('returns quaternion that aligns forward vector to curve tangent', () => {
    const points = [
      [0, 0, 0],
      [10, 0, 0],
    ];

    const { quaternion } = getStartPoseFromCurve(points, 0.25);
    const forward = rotateForwardByQuatArray(quaternion);

    expect(forward.x).toBeCloseTo(1, 6);
    expect(forward.y).toBeCloseTo(0, 6);
    expect(forward.z).toBeCloseTo(0, 6);
  });
});

describe('lookRotation', () => {
  test('returns identity when already facing -Z with up +Y', () => {
    const quat = lookRotation([0, 0, -1], [0, 1, 0]);
    expect(quat[0]).toBeCloseTo(0, 6);
    expect(quat[1]).toBeCloseTo(0, 6);
    expect(quat[2]).toBeCloseTo(0, 6);
    expect(quat[3]).toBeCloseTo(1, 6);
  });

  test('rotates local forward to requested forward direction', () => {
    const targetForward = [1, 0, 0];
    const quat = lookRotation(targetForward, [0, 1, 0]);
    const forward = rotateForwardByQuatArray(quat);

    expect(forward.x).toBeCloseTo(1, 6);
    expect(forward.y).toBeCloseTo(0, 6);
    expect(forward.z).toBeCloseTo(0, 6);
  });
});

describe('createThrottle', () => {
  test('calls callback only when interval has elapsed', () => {
    const callback = jest.fn();
    const nowSpy = jest.spyOn(Date, 'now');
    const throttled = createThrottle(2, callback); // every 500ms

    nowSpy.mockReturnValue(1000);
    throttled('a');
    nowSpy.mockReturnValue(1200);
    throttled('b');
    nowSpy.mockReturnValue(1500);
    throttled('c');
    nowSpy.mockReturnValue(1600);
    throttled('d');
    nowSpy.mockReturnValue(2100);
    throttled('e');

    expect(callback).toHaveBeenCalledTimes(3);
    expect(callback).toHaveBeenNthCalledWith(1, 'a');
    expect(callback).toHaveBeenNthCalledWith(2, 'c');
    expect(callback).toHaveBeenNthCalledWith(3, 'e');

    nowSpy.mockRestore();
  });
});
