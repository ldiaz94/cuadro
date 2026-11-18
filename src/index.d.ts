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

import type { Getter, Child } from 'spark';
/** Content placed in time: a function of a frame getter. */
export type View = (frame: Getter<number>) => Child;
/** Shows view from frame `from` for `duration` frames, counting its frames from 0. */
export function sequence(from: number, duration: number, view: View): View;
/** Plays [duration, view] clips back to back. */
export function series(...clips: [duration: number, view: View][]): View;
/**
 * A view that plays the sound file src from its first frame until it unmounts. Its first frame is its
 * sequence's local frame 0, wherever audio() appears in the view: to start a sound later, give it its own
 * sequence, and don't show or hide it with a condition inside a sequence.
 */
export function audio(src: string, options?: { volume?: number }): View;

/** A sound recorded by audio() when it mounted, for the renderer to mix. */
export interface Clip {
  /** The file's URL, resolved against the page's. */
  src: string;
  /** The composition frame at which the clip starts. */
  from: number;
  /** The composition frame at which it was unmounted, if it was. */
  until?: number;
  /** A gain, 1 as recorded. */
  volume: number;
}

/** What window.cuadro holds: the video's size, rate and length, and setFrame. */
export interface Composition {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  /** The audio clips mounted so far. */
  clips: Clip[];
  /** Shows frame n; resolves once fonts and images are ready, rejects if an image fails. */
  setFrame(n: number): Promise<void>;
  /** Subtitles, in seconds; when set (the player sets them for `captions: true`), render writes them beside the mp4 as .srt. */
  captions?: { start: number; end: number; text: string }[];
}
/** Mounts view(frame, props) on a stage and makes the page renderable (and previewable). */
export function composition<P extends object = Record<string, unknown>>(options: {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  view: (frame: Getter<number>, props: P) => Child;
  props?: P;
}): Composition;

export * from 'spark';
