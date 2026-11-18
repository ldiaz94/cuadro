// Types for cuadro/make, the Node side: what TypeScript sees of src/make.js.

/** Asks a language model for a video.js from prompt, checks it in Chromium, and has it fixed and reviewed. */
export function make(options: {
  /** What the video should show. */
  prompt: string;
  /** "anthropic", "gemini" or "openai" (also any OpenAI-compatible server). */
  provider: string;
  /** The provider's model (default: the provider's own). */
  model?: string;
  /** Overrides the provider's API address. */
  baseUrl?: string;
  /** The output folder, inside root and not root itself (default: "make-out"). */
  out?: string;
  /** How many revisions after the first draft, at most (default: 3). */
  rounds?: number;
  /** The directory served to Chromium; cuadro must be installed in it (default: the working directory). */
  root?: string;
  /** A speech provider for cuadro/voice; set it to narrate the video. */
  voiceProvider?: string;
  /** The speech provider's voice (default: the provider's own). */
  voice?: string;
  /** How long one step in Chromium may take, in milliseconds (default: 30000); a slower one is a problem sent to the model. */
  timeout?: number;
  /** Called with each progress message. */
  onStep?: (message: string) => void;
}): Promise<{
  /** <out>/index.html, which loads video.js. */
  page: string;
  /** <out>/video.js, the last file that passed the check. */
  file: string;
  /** Whether the model saw that file's frames and approved it; false when the review failed or the rounds ran out. */
  reviewed: boolean;
}>;
