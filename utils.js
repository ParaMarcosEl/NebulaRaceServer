// Utilities for physics and pose calculations
export function getStartPoseFromCurve(points, distance = 0) {
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
export function lookRotation(forward, up) {
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
    } else if ((m00 > m11) & (m00 > m22)) {
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

// Throttle
export function createThrottle(timesPerSecond, callback) {
    const interval = 1000 / timesPerSecond; // ms between allowed calls
    let lastTime = 0;

    return function throttled(...args) {
        const now = Date.now();
        if (now - lastTime >= interval) {
            lastTime = now;
            callback(...args);
        }
    };
}


