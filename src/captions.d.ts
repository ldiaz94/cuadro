// Types for cuadro/captions, browser-side: what TypeScript sees of src/captions.js.
import type { View } from './index.js';
import type { Word } from './level.js';

/** A phrase of the narration: its text, the words in it, and when it is shown, in seconds. */
export interface Cue {
  start: number;
  end: number;
  text: string;
  words: Word[];
}

/** Groups words (seconds from the video's start) into phrases of at most MaxChars, cut after punctuation or at a pause. */
export function cues(words: readonly Word[]): Cue[];
/** The captions view: the phrase being said at the bottom of the frame, its current word in the accent. Draw it inside stage(). */
export function captions(words: readonly Word[]): View;
/** The most characters in a phrase. */
export const MaxChars: number;
/** The height to keep clear at the bottom for the captions: set it as the stage's '--safe-bottom' and the designed scenes keep above it. */
export const CaptionBand: string;
