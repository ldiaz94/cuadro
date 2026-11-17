// Types for cuadro's browser side, written by hand beside the JavaScript
// (there is no build step): what TypeScript sees of src/index.js.

/** Maps t in [0, 1] to eased progress, 0 at 0 and 1 at 1. */
export type Easing = (t: number) => number;
/** What happens beyond the first and last stop. */
export type Extrapolate = 'clamp' | 'extend';

/** Maps x from inRange to outRange, piecewise over matching, increasing stops. */
export function interpolate(
  x: number,
  inRange: readonly number[],
  outRange: readonly number[],
  options?: { easing?: Easing; extrapolate?: Extrapolate | { left: Extrapolate; right: Extrapolate } },
): number;
/** A damped spring from `from` (default 0) to `to` (default 1), released at frame 0. */
export function spring(options: {
  frame: number;
  fps: number;
  config?: { mass?: number; stiffness?: number; damping?: number };
  from?: number;
  to?: number;
}): number;
/** CSS's cubic-bezier curve. */
export function bezier(x1: number, y1: number, x2: number, y2: number): Easing;
export const linear: Easing;
export const ease: Easing;
export const easeIn: Easing;
export const easeOut: Easing;
export const easeInOut: Easing;
