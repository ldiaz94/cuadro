// Types for cuadro/level, browser-safe: what TypeScript sees of src/level.js.

/** The loudness at a frame, 0 to 1, averaged with its neighbours; 0 outside the line. levels is a line's `levels` in voice.json. */
export function level(levels: readonly number[], frame: number): number;

/** A spoken word from a line's `words` in voice.json: its text and when it is said, in seconds from the line's start. */
export interface Word {
  text: string;
  start: number;
  end: number;
}

/** The index of the word being said at a frame (the last one started by then); -1 before the first. */
export function word(words: readonly Word[], frame: number, fps: number): number;
