// Types for cuadro/render, the Node side: what TypeScript sees of src/render.js.

/** Renders a composition page to an mp4 with headless Chromium and ffmpeg. */
export function render(options: {
  /** The page's file path; it must be under root. */
  page: string;
  /** The mp4 to write. */
  out: string;
  /** Merged over the composition's default props. */
  props?: object;
  /** A soundtrack, cut or padded with silence to the video's length. */
  audio?: string;
  /** The directory served to the browser (default: the working directory). */
  root?: string;
  /** Called after each frame. */
  onProgress?: (done: number, total: number) => void;
}): Promise<void>;
