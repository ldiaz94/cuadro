// Types for cuadro/translate, the Node side: what TypeScript sees of src/translate.js.

/** Translates a scene script's say lines and screen text into `to` (BCP-47) with a language model; writes script.<to>.json beside it and resolves to its path. */
export function translate(options: {
  /** The scene script file. */
  script: string;
  /** The language to translate into, e.g. "es" or "pt-BR". */
  to: string;
  /** "anthropic", "gemini" or "openai". */
  provider: string;
  /** The provider's model (default: the provider's own). */
  model?: string;
  /** Overrides the provider's API address. */
  baseUrl?: string;
}): Promise<string>;
