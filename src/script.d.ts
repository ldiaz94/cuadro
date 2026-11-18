// Types for cuadro/script, written by hand beside src/script.js.

/** One scene of a script: a designed scene with its props, or a code scene module; `say` is its narration line. */
export type ScriptScene =
  | { type: 'title' | 'kinetic' | 'stat' | 'steps' | 'tiles' | 'endCard'; props: Record<string, unknown>; say?: string }
  | { code: string; say?: string };
/** A video as data: a theme, a brand, a soundtrack (a path relative to script.json) and the scenes in order. */
export interface Script {
  theme?: 'light' | 'bold' | 'dark';
  brand?: { accent?: string; accent2?: string; logo?: string };
  music?: string;
  /** The language of its text, a BCP-47 code ("es", "pt-BR", "ja"). */
  language?: string;
  /** Burn the narration in as captions, and have render write an .srt beside the mp4. */
  captions?: boolean;
  /** A font file (relative to script.json) for letters the bundled Latin fonts lack. */
  font?: string;
  scenes: ScriptScene[];
}
/** The parts of a voice.json that timing() reads. */
export interface Narration {
  fps?: number;
  lines: { id: string; file: string; seconds: number; levels?: number[]; words?: { text: string; start: number; end: number }[] }[];
}

/**
 * Returns script if it matches the schema; otherwise throws an error naming the bad path, e.g. `scenes[2].props.items: expected an array`.
 * Text with letters the bundled fonts lack fails too, unless the script names a `font`.
 */
export function check(script: unknown): Script;
/** The id of scene i's line: `scene<i+1>`. */
export function lineId(i: number): string;
/** The `say` lines as a script for cuadro/voice. */
export function lines(script: Script): { lines: { id: string; text: string }[] };
/** Frames of quiet after a line. */
export const Air: number;
/** Frames the last scene holds after its line. */
export const Hold: number;
/** Each scene's length in frames, from its line in voice.json (plus air) or its type's default, and the line itself. */
export function timing(script: Script, voice?: Narration, fps?: number): { length: number; line?: Narration['lines'][number] }[];
