// Types for cuadro/make, the Node side: what TypeScript sees of src/make.js.

/** Asks a language model for a scene script (and its code scenes) from prompt, checks it in Chromium, and has it fixed and reviewed. */
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
  /** An image file, copied into out and set as the script's brand logo (the endCard shows it). */
  logo?: string;
  /** The brand's #rrggbb colours, set in every draft whatever the model writes. */
  brand?: { accent?: string; accent2?: string };
  /** A sound file, copied into out and set as the script's music, under the narration. */
  music?: string;
  /** The video's language, a BCP-47 code ("es", "pt-BR"): the model writes in it, and the script's language is set to it. */
  language?: string;
  /** The frame's shape, "16:9" (the default) or "9:16" for a portrait video, set in every draft. */
  format?: '16:9' | '9:16';
  /** Show the narration as captions (the script's captions: true), set in every draft. */
  captions?: boolean;
  /** How long one step in Chromium may take, in milliseconds (default: 30000); a slower one is a problem sent to the model. */
  timeout?: number;
  /** Called with each progress message. */
  onStep?: (message: string) => void;
}): Promise<{
  /** <out>/index.html, which plays the script. */
  page: string;
  /** <out>/script.json, the last script that passed the check; its code scenes are in <out>/scenes. */
  file: string;
  /** Whether the model saw that script's stills and approved it; false when the review failed or the rounds ran out. */
  reviewed: boolean;
}>;
