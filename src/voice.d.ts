// Types for cuadro/voice, the Node side: what TypeScript sees of src/voice.js.

/** One spoken line, as listed in voice.json. */
export interface VoiceLine {
  /** The line's id from the script. */
  id: string;
  /** The audio file, relative to the output directory. */
  file: string;
  /** The audio's length in seconds. */
  seconds: number;
  /** sha256 of provider, voice, model and text; the cache key. */
  hash: string;
  /** Loudness per video frame, 0 to 1 (2 decimals), ceil(seconds * fps) numbers; the line's loudest frame is 1. */
  levels: number[];
}

/** Turns a script of lines into audio files and a voice.json; unchanged lines are not spoken again. */
export function voice(options: {
  /** The script file: { "lines": [{ "id", "text" }] }. */
  script: string;
  /** The output directory (default: "voice"). */
  out?: string;
  /** "elevenlabs", "gemini", "openai" or "qwen". */
  provider: string;
  /** The provider's voice (default: the provider's own). */
  voice?: string;
  /** The provider's model (default: the provider's own). */
  model?: string;
  /** Overrides the provider's API address. */
  baseUrl?: string;
  /** Frames per second of the levels (default: 30). */
  fps?: number;
  /** Called after each line; skipped is true when the file was reused. */
  onLine?: (line: { id: string; index: number; total: number; skipped: boolean }) => void;
}): Promise<{ fps: number; lines: VoiceLine[] }>;
