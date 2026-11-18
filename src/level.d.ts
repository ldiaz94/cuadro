// Types for cuadro/level, browser-safe: what TypeScript sees of src/level.js.

/** The loudness at a frame, 0 to 1, averaged with its neighbours; 0 outside the line. levels is a line's `levels` in voice.json. */
export function level(levels: readonly number[], frame: number): number;
