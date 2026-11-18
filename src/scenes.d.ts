// Types for cuadro/scenes, written by hand beside src/scenes.js.
import type { Getter, Child } from 'spark';
import type { View } from './index.js';
import type { Theme } from './theme.js';
import type { Word } from './level.js';

/** Frames a scene takes to fade in, and out; play() overlaps scenes by this much. */
export const Fade: number;
/** Splits [0, length - Fade) into n back-to-back beats; throws if a beat would be under 15 frames. */
export function beats(length: number, n: number): { from: number; to: number }[];
/** Plays [length, view] clips in order, each cross-fading into the next over Fade frames. */
export function play(...clips: [length: number, view: View][]): View;
/** How long play(...clips) lasts: the lengths' sum less Fade for each overlap. */
export function playLength(...clips: [length: number, view: View][]): number;
/** The themed frame, with a drifting glow behind the view. */
export function stage(theme: Theme, view: View): View;

/** What a scene's body gets: the frame, a spring released at a frame, and eased progress between two frames. */
export interface SceneTime {
  frame: Getter<number>;
  /** 0 to 1 (with a little overshoot), released at frame `at`. */
  enter(at: number): number;
  /** 0 to 1, eased, from frame a to frame b. */
  between(a: number, b: number): number;
}
/** A scene of `length` frames that fades in and out (fadeOut: false holds the end) and drifts; for scenes written as code. */
export function scene(length: number, body: (t: SceneTime) => Child, options?: { className?: string; fadeOut?: boolean }): View;

/** Text where *words* between asterisks are marked, and a newline breaks the line. */
export type Marked = string;
/** An item of a list or grid. */
export interface Item {
  title: string;
  text?: string;
}

/** Given `words`, its narration line's words from voice.json, kinetic, steps and tiles start each beat as the line names its item. */

/** A kicker, a headline word by word, a mark swept under *words*, and a sub line. */
export function title(props: { length: number; kicker?: string; title: Marked; sub?: string }): View;
/** Two to four short lines, one per beat, each below the last, which dims. */
export function kinetic(props: { length: number; lines: Marked[]; words?: Word[] }): View;
/** 1 to 3 numbers in rows, each counting up in its own beat. */
export function stat(props: {
  length: number;
  title?: string;
  stats: { value: number; prefix?: string; suffix?: string; label: string }[];
}): View;
/** A list with a highlight moving down it, one step per beat, the current step shown large. */
export function steps(props: { length: number; title?: string; items: Item[]; words?: Word[] }): View;
/** 2 to 6 tiles, with a highlight moving through them, one per beat. */
export function tiles(props: { length: number; title?: string; items: Item[]; words?: Word[] }): View;
/** A logo (image URL) and a line, then a call to action and a URL; held to the end, with no fade-out. */
export function endCard(props: { length: number; logo?: string; line: Marked; cta?: string; url?: string }): View;
