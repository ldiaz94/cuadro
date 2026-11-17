// cuadro animation helpers: interpolate, spring and easings.
// Pure functions of a number (usually the frame), so the same frame always
// gives the same value: nothing here reads the clock or keeps state.
// Depends on nothing. Leaves out colour interpolation, springs with an
// initial velocity, and easings beyond CSS's cubic-bezier curves.

/** Maps x from inRange to outRange, piecewise over matching stops. */
export function interpolate(x, inRange, outRange, { easing = linear, extrapolate = 'clamp' } = {}) {
  const n = inRange.length;
  if (n < 2 || outRange.length !== n) throw new Error('interpolate: need two or more stops, the same number in and out');
  for (let i = 1; i < n; i++) {
    if (!(inRange[i] > inRange[i - 1])) throw new Error('interpolate: inRange must be strictly increasing');
  }
  const { left, right } = typeof extrapolate === 'string' ? { left: extrapolate, right: extrapolate } : extrapolate;
  let i = 0; // the segment [inRange[i], inRange[i + 1]] that x falls in or nearest to
  while (i < n - 2 && x >= inRange[i + 1]) i++;
  let t = (x - inRange[i]) / (inRange[i + 1] - inRange[i]);
  if (t < 0) t = left === 'clamp' ? 0 : t;
  else if (t > 1) t = right === 'clamp' ? 1 : t;
  else t = easing(t); // beyond the ends, 'extend' continues the end segment's straight line
  return outRange[i] + t * (outRange[i + 1] - outRange[i]);
}

/** A damped spring from `from` to `to`, released at frame 0, at rest before it. */
export function spring({ frame, fps, config = {}, from = 0, to = 1 }) {
  const { mass = 1, stiffness = 100, damping = 10 } = config;
  if (frame <= 0) return from;
  const t = frame / fps;
  const x0 = from - to; // displacement from rest, released with no velocity
  const w0 = Math.sqrt(stiffness / mass); // natural frequency
  const zeta = damping / (2 * Math.sqrt(stiffness * mass)); // below 1 it overshoots
  let x;
  if (Math.abs(zeta - 1) < 1e-9) {
    x = x0 * (1 + w0 * t) * Math.exp(-w0 * t);
  } else if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    x = x0 * Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t));
  } else {
    const s = w0 * Math.sqrt(zeta * zeta - 1);
    const r1 = -zeta * w0 + s, r2 = -zeta * w0 - s; // both negative: two decays, no swing
    x = (x0 / (r2 - r1)) * (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t));
  }
  return to + x;
}

/** CSS's cubic-bezier(x1, y1, x2, y2) as a function of t in [0, 1]. */
export function bezier(x1, y1, x2, y2) {
  if (!(x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1)) throw new Error('bezier: x1 and x2 must be in [0, 1]');
  const curve = (a, b) => (s) => 3 * a * s * (1 - s) ** 2 + 3 * b * (1 - s) * s * s + s ** 3;
  const cx = curve(x1, x2), cy = curve(y1, y2);
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let lo = 0, hi = 1; // cx rises from 0 to 1, so bisect for the s where cx(s) = t
    for (let k = 0; k < 50; k++) {
      const s = (lo + hi) / 2;
      if (cx(s) < t) lo = s;
      else hi = s;
    }
    return cy((lo + hi) / 2);
  };
}

/** No easing. */
export const linear = (t) => t;
/** CSS's named curves. */
export const ease = bezier(0.25, 0.1, 0.25, 1);
export const easeIn = bezier(0.42, 0, 1, 1);
export const easeOut = bezier(0, 0, 0.58, 1);
export const easeInOut = bezier(0.42, 0, 0.58, 1);
